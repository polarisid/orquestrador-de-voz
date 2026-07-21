import { supabase } from './supabase.js';
import { FLUXOS } from '../agent/fluxos.js';

/**
 * Fila de discagem.
 *
 * Sem isto o painel disca uma OS por vez, na mão. A fila recebe uma lista,
 * respeita a janela de atendimento, limita quantas ligações acontecem ao mesmo
 * tempo e reagenda quem não atendeu.
 *
 * Os três limites existem por motivos diferentes:
 *  - janela: ninguém liga para cliente às 22h
 *  - concorrência: seu ramal iFalei aguenta poucas simultâneas, e estourar
 *    isso gera chamadas recusadas que parecem falha do agente
 *  - tentativas: insistir sem limite vira perseguição
 */

const INTERVALO_MS = 8_000;
const MAX_TENTATIVAS = 3;
const ESPERA_ENTRE_TENTATIVAS_MS = 90 * 60_000;

const maxSimultaneas = () => Number(process.env.MAX_CHAMADAS_SIMULTANEAS ?? 1);

const ATIVOS = ['discando', 'em_andamento'];

export function dentroDaJanela(d = new Date()) {
  const br = new Date(d.toLocaleString('en-US', { timeZone: 'America/Maceio' }));
  const h = br.getHours();
  return br.getDay() !== 0 && h >= 8 && h < 20;
}

/** Adiciona itens à fila. Retorna quantos entraram e o que foi recusado. */
export async function enfileirar(fluxo: string, itens: Record<string, string>[]) {
  const f = FLUXOS[fluxo];
  if (!f) throw new Error('fluxo desconhecido');

  const aceitos: any[] = [];
  const recusados: { linha: number; motivo: string }[] = [];

  itens.forEach((d, i) => {
    const faltando = f.campos
      .filter((c) => c.obrigatorio && !String(d[c.nome] ?? '').trim())
      .map((c) => c.rotulo);

    if (faltando.length) {
      recusados.push({ linha: i + 1, motivo: `faltou: ${faltando.join(', ')}` });
      return;
    }
    const tel = String(d.telefone ?? '').replace(/\D/g, '');
    if (tel.length < 10 || tel.length > 11) {
      recusados.push({ linha: i + 1, motivo: `telefone inválido: ${d.telefone}` });
      return;
    }
    aceitos.push({ fluxo, dados: { ...d, telefone: tel }, status: 'pendente', tentativas: 0 });
  });

  for (const a of aceitos) await supabase.from('fila').insert(a);
  return { enfileirados: aceitos.length, recusados };
}

/**
 * Converte texto colado (CSV ou TSV, com cabeçalho) em objetos.
 * Aceita o nome técnico do campo ou o rótulo do formulário no cabeçalho —
 * quem cola uma planilha não sabe que a coluna se chama "os_numero".
 */
export function lerTabela(texto: string, fluxo: string) {
  const f = FLUXOS[fluxo];
  if (!f) throw new Error('fluxo desconhecido');

  const linhas = texto.trim().split(/\r?\n/).filter((l) => l.trim());
  if (linhas.length < 2) return [];

  const sep = linhas[0].includes('\t') ? '\t' : linhas[0].split(';').length > linhas[0].split(',').length ? ';' : ',';
  const chave = (s: string) =>
    s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

  const porRotulo = new Map(f.campos.map((c) => [chave(c.rotulo), c.nome]));
  const porNome = new Map(f.campos.map((c) => [chave(c.nome), c.nome]));

  const cabecalho = linhas[0].split(sep).map((h) => {
    const k = chave(h);
    return porNome.get(k) ?? porRotulo.get(k) ?? k;
  });

  return linhas.slice(1).map((l) => {
    const celulas = l.split(sep);
    const o: Record<string, string> = {};
    cabecalho.forEach((c, i) => { o[c] = (celulas[i] ?? '').trim(); });
    return o;
  });
}

// ---------------------------------------------------------------------------

async function rodada(
  disparar: (fluxo: string, dados: Record<string, string>) => Promise<{ id: string }>,
  log: { info: Function; warn: Function },
) {
  const { data: filaBruta } = await supabase.from('fila').select('*');
  const fila = (filaBruta ?? []) as any[];

  const pendentes = fila
    .filter((f) => f.status === 'pendente')
    .filter((f) => !f.proxima_em || new Date(f.proxima_em) <= new Date())
    .sort((a, b) => (a.criada_em ?? '').localeCompare(b.criada_em ?? ''));

  if (!pendentes.length) return;
  if (!dentroDaJanela() && process.env.DRY_RUN !== 'true') return;

  const { data: chamadasBrutas } = await supabase.from('chamadas_triagem').select('*');
  const emCurso = ((chamadasBrutas ?? []) as any[]).filter((c) => ATIVOS.includes(c.status)).length;

  const vagas = maxSimultaneas() - emCurso;
  if (vagas <= 0) return;

  for (const item of pendentes.slice(0, vagas)) {
    try {
      const { id: chamadaId } = await disparar(item.fluxo, item.dados);
      await supabase.from('fila').update({
        status: 'discada',
        chamada_id: chamadaId,
        tentativas: (item.tentativas ?? 0) + 1,
        ultima_em: new Date().toISOString(),
      }).eq('id', item.id);
      log.info({ fila: item.id, fluxo: item.fluxo }, 'fila: chamada disparada');
    } catch (e) {
      const tentativas = (item.tentativas ?? 0) + 1;
      await supabase.from('fila').update({
        tentativas,
        status: tentativas >= MAX_TENTATIVAS ? 'falhou' : 'pendente',
        erro: String(e).slice(0, 300),
        proxima_em: new Date(Date.now() + ESPERA_ENTRE_TENTATIVAS_MS).toISOString(),
      }).eq('id', item.id);
      log.warn({ e: String(e), fila: item.id }, 'fila: falha ao disparar');
    }
  }
}

/**
 * Itens já discados cuja chamada terminou sem contato voltam para a fila,
 * com espera. É o que faz "ligou e ninguém atendeu" virar nova tentativa
 * sem ninguém precisar lembrar.
 */
async function reprocessar(log: { info: Function }) {
  const { data: filaBruta } = await supabase.from('fila').select('*');
  const discadas = ((filaBruta ?? []) as any[]).filter((f) => f.status === 'discada' && f.chamada_id);
  if (!discadas.length) return;

  const { data: chamadasBrutas } = await supabase.from('chamadas_triagem').select('*');
  const porId = new Map(((chamadasBrutas ?? []) as any[]).map((c) => [c.id, c]));

  for (const item of discadas) {
    const c = porId.get(item.chamada_id);
    if (!c || ATIVOS.includes(c.status)) continue;

    const semContato = ['sem_contato', 'reagendar', 'cliente_desligou'].includes(c.status);
    const tentativas = item.tentativas ?? 1;

    if (semContato && tentativas < MAX_TENTATIVAS) {
      await supabase.from('fila').update({
        status: 'pendente',
        chamada_id: null,
        proxima_em: new Date(Date.now() + ESPERA_ENTRE_TENTATIVAS_MS).toISOString(),
      }).eq('id', item.id);
      log.info({ fila: item.id, tentativas }, 'fila: reagendada');
    } else {
      await supabase.from('fila').update({
        status: semContato ? 'sem_contato' : 'concluida',
        finalizada_em: new Date().toISOString(),
      }).eq('id', item.id);
    }
  }
}

export function iniciarFila(
  disparar: (fluxo: string, dados: Record<string, string>) => Promise<{ id: string }>,
  log: { info: Function; warn: Function },
) {
  setInterval(() => {
    reprocessar(log)
      .then(() => rodada(disparar, log))
      .catch((e) => log.warn({ e: String(e) }, 'fila: rodada falhou'));
  }, INTERVALO_MS).unref();
}
