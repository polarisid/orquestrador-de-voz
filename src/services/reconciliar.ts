import { supabase } from './supabase.js';
import { voz } from './voice-provider.js';
import { normalizar } from './transcricao.js';

/**
 * O webhook pós-chamada da ElevenLabs pode não estar configurado, ou pode se
 * perder. Sem ele o cartão fica preso em "na linha" para sempre.
 *
 * Este laço pergunta o estado das chamadas ativas de tempos em tempos e
 * finaliza as que já acabaram. É rede de segurança, não o caminho principal:
 * o webhook continua sendo mais rápido quando funciona.
 */
const ATIVOS = ['discando', 'em_andamento', 'pendente'];
const INTERVALO_MS = 12_000;
const MAX_POR_RODADA = 5;

/** Sem isso, uma chamada que nunca completa fica sendo consultada eternamente. */
const IDADE_MAXIMA_MS = 20 * 60_000;

async function rodada(log: { warn: (o: unknown, m?: string) => void }) {
  const { data } = await supabase.from('chamadas_triagem').select('*');
  const ativas = ((data ?? []) as any[])
    .filter((c) => ATIVOS.includes(c.status))
    .slice(0, MAX_POR_RODADA);

  for (const c of ativas) {
    const idade = Date.now() - new Date(c.criada_em ?? 0).getTime();

    if (idade > IDADE_MAXIMA_MS) {
      await supabase
        .from('chamadas_triagem')
        .update({ status: 'sem_contato', ultimo_resultado: 'timeout', finalizada_em: new Date().toISOString() })
        .eq('id', c.id);
      continue;
    }

    // Dá um tempo para a conversa existir do lado deles antes de perguntar.
    if (idade < 15_000) continue;

    try {
      const conv: any = await voz.conversa(c.provider_call_id);
      const acabou = ['done', 'failed', 'processing'].includes(conv.status);
      if (!acabou) continue;

      const duracao = conv.metadata?.call_duration_secs ?? 0;
      const motivo = conv.metadata?.termination_reason ?? '';

      // Chamada curtíssima sem nenhuma tool call: ninguém atendeu de fato.
      const semContato = duracao < 5 && c.etapa === 'abertura';

      await supabase
        .from('chamadas_triagem')
        .update({
          status: semContato ? 'sem_contato' : c.status === 'discando' ? 'cliente_desligou' : 'concluida',
          duracao_segundos: duracao,
          transcricao: normalizar(conv.transcript),
          resumo: conv.analysis?.transcript_summary ?? null,
          ultimo_resultado: motivo || null,
          finalizada_em: new Date().toISOString(),
        })
        .eq('id', c.id);
    } catch (e) {
      log.warn({ e: String(e), id: c.id }, 'reconciliacao falhou');
    }
  }
}

export function iniciarReconciliacao(log: { warn: (o: unknown, m?: string) => void }) {
  if (!process.env.ELEVENLABS_API_KEY) return;
  setInterval(() => {
    rodada(log).catch((e) => log.warn({ e: String(e) }, 'rodada de reconciliacao falhou'));
  }, INTERVALO_MS).unref();
}
