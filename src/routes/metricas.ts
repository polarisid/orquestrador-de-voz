import type { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase.js';
import { FLUXOS } from '../agent/fluxos.js';

/**
 * Números da operação de voz.
 *
 * Escolhi as métricas que mudam decisão, não as que enchem tela:
 * quantas ligações chegam a falar com alguém, quanto tempo dura,
 * quantas precisam de humano, e — a que mais importa aqui — quantos
 * cadastros estavam errados na OS.
 */
const CONTATO = ['concluida', 'parcial', 'transferida', 'encerrada_pelo_operador', 'cliente_desligou'];
const SEM_CONTATO = ['sem_contato', 'reagendar', 'recusou_gravacao', 'nao_e_o_titular'];

export async function rotasMetricas(app: FastifyInstance) {
  app.get<{ Querystring: { dias?: string } }>('/metricas', async (req) => {
    const dias = Math.min(90, Math.max(1, Number(req.query.dias ?? 30)));
    const corte = Date.now() - dias * 864e5;

    const { data } = await supabase.from('chamadas_triagem').select('*');
    const todas = ((data ?? []) as any[]).filter(
      (c) => new Date(c.criada_em ?? 0).getTime() >= corte,
    );

    const finalizadas = todas.filter((c) => c.finalizada_em);
    const comContato = finalizadas.filter((c) => CONTATO.includes(c.status));
    const semContato = finalizadas.filter((c) => SEM_CONTATO.includes(c.status));

    const duracoes = comContato.map((c) => c.duracao_segundos ?? 0).filter((d) => d > 0);
    const media = duracoes.length
      ? Math.round(duracoes.reduce((a, b) => a + b, 0) / duracoes.length)
      : 0;

    const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

    const porFluxo = Object.values(FLUXOS).map((f) => {
      const doFluxo = todas.filter((c) => (c.fluxo ?? 'triagem') === f.id);
      const fin = doFluxo.filter((c) => c.finalizada_em);
      const cont = fin.filter((c) => CONTATO.includes(c.status));
      return {
        id: f.id,
        nome: f.nome,
        total: doFluxo.length,
        taxa_contato: pct(cont.length, fin.length),
        concluidas: doFluxo.filter((c) => c.status === 'concluida').length,
      };
    }).filter((f) => f.total > 0);

    return {
      dias,
      total: todas.length,
      finalizadas: finalizadas.length,
      taxa_contato: pct(comContato.length, finalizadas.length),
      sem_contato: semContato.length,
      duracao_media_segundos: media,
      minutos_falados: Math.round(duracoes.reduce((a, b) => a + b, 0) / 60),

      // O achado que costuma justificar o projeto sozinho.
      cadastro_corrigido: comContato.filter((c) => c.cadastro_corrigido).length,
      taxa_cadastro_corrigido: pct(
        comContato.filter((c) => c.cadastro_corrigido).length,
        comContato.length,
      ),

      transferidas: todas.filter((c) => c.status === 'transferida').length,
      taxa_transferencia: pct(
        todas.filter((c) => c.status === 'transferida').length,
        comContato.length,
      ),
      sintoma_divergente: comContato.filter((c) => c.divergiu_abertura).length,
      documentos_enviados: comContato.filter((c) => c.doc_enviado_em).length,
      pendentes_revisao: finalizadas.filter((c) => !c.revisada_em).length,
      por_fluxo: porFluxo,
    };
  });
}
