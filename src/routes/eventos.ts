import type { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase.js';

/**
 * Webhook pós-chamada da ElevenLabs.
 * Configure em Workspace > Webhooks apontando para /webhooks/elevenlabs.
 *
 * O corpo tem a forma { type, event_timestamp, data }. Interessam:
 *   post_call_transcription — transcrição, duração, motivo do encerramento
 */
interface EventoEL {
  type: string;
  data?: {
    conversation_id?: string;
    status?: string;
    transcript?: { role: string; message: string; time_in_call_secs?: number }[];
    metadata?: {
      call_duration_secs?: number;
      termination_reason?: string;
      phone_call?: { direction?: string };
    };
    analysis?: { call_successful?: string; transcript_summary?: string };
  };
}

const NAO_ATENDEU = ['no_answer', 'busy', 'failed', 'voicemail', 'not_answered', 'rejected'];
const MAX_TENTATIVAS = 3;

export async function rotasEventos(app: FastifyInstance) {
  app.post<{ Body: EventoEL }>('/webhooks/elevenlabs', async (req) => {
    const { type, data } = req.body ?? {};
    const id = data?.conversation_id;
    if (!id) return { ok: true };

    const { data: chamada } = await supabase
      .from('chamadas_triagem')
      .select('id, tentativas, status')
      .eq('provider_call_id', id)
      .single();
    if (!chamada) return { ok: true };

    req.log.info({ type, id, status: data?.status }, 'evento_elevenlabs');

    if (type !== 'post_call_transcription') return { ok: true };

    const motivo = data?.metadata?.termination_reason ?? '';
    const duracao = data?.metadata?.call_duration_secs ?? 0;

    // Não atendeu / caiu na caixa postal: conta tentativa e reagenda.
    if (NAO_ATENDEU.some((m) => motivo.toLowerCase().includes(m)) || duracao < 5) {
      const tentativas = (chamada.tentativas ?? 0) + 1;
      await supabase
        .from('chamadas_triagem')
        .update({
          tentativas,
          status: tentativas >= MAX_TENTATIVAS ? 'sem_contato' : 'reagendar',
          ultimo_resultado: motivo || 'sem_atendimento',
          duracao_segundos: duracao,
        })
        .eq('id', chamada.id);
      return { ok: true };
    }

    // Se a tool encerrar_triagem já rodou, ela gravou o status definitivo.
    const aberta = ['discando', 'em_andamento', 'pendente'].includes(chamada.status ?? '');

    await supabase
      .from('chamadas_triagem')
      .update({
        duracao_segundos: duracao,
        transcricao: data?.transcript ?? null,
        resumo: data?.analysis?.transcript_summary ?? null,
        ultimo_resultado: motivo || null,
        finalizada_em: new Date().toISOString(),
        ...(aberta ? { status: 'cliente_desligou' } : {}),
      })
      .eq('id', chamada.id);

    return { ok: true };
  });

  // Mantido para os mocks e para testes locais.
  app.post<{
    Body: {
      call_id: string;
      event: string;
      duration_seconds?: number;
      recording_url?: string;
      transcript?: unknown;
    };
  }>('/webhooks/call-event', async (req) => {
    const { call_id, event, duration_seconds, recording_url, transcript } = req.body;
    const { data: chamada } = await supabase
      .from('chamadas_triagem')
      .select('id, status')
      .eq('provider_call_id', call_id)
      .single();
    if (!chamada) return { ok: true };

    if (event === 'call_answered') {
      await supabase
        .from('chamadas_triagem')
        .update({ status: 'em_andamento', atendida_em: new Date().toISOString() })
        .eq('id', chamada.id);
      return { ok: true };
    }

    await supabase
      .from('chamadas_triagem')
      .update({
        duracao_segundos: duration_seconds ?? 0,
        gravacao_url: recording_url ?? null,
        transcricao: (transcript as any) ?? null,
        finalizada_em: new Date().toISOString(),
        status: chamada.status === 'em_andamento' ? 'cliente_desligou' : chamada.status,
      })
      .eq('id', chamada.id);

    return { ok: true };
  });
}
