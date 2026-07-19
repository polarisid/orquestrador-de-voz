import type { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase.js';

type Evento =
  | 'call_answered'
  | 'call_ended'
  | 'no_answer'
  | 'busy'
  | 'failed'
  | 'voicemail_detected';

interface EventoBody {
  call_id: string;
  event: Evento;
  duration_seconds?: number;
  recording_url?: string;
  transcript?: { role: 'agent' | 'user'; text: string; ts: number }[];
}

const MAX_TENTATIVAS = 3;

export async function rotasEventos(app: FastifyInstance) {
  app.post<{ Body: EventoBody }>('/webhooks/call-event', async (req) => {
    const { call_id, event, duration_seconds, recording_url, transcript } = req.body;

    const { data: chamada } = await supabase
      .from('chamadas_triagem')
      .select('id, tentativas, status')
      .eq('provider_call_id', call_id)
      .single();
    if (!chamada) return { ok: true };

    if (event === 'call_answered') {
      await supabase.from('chamadas_triagem')
        .update({ status: 'em_andamento', atendida_em: new Date().toISOString() })
        .eq('id', chamada.id);
      return { ok: true };
    }

    if (['no_answer', 'busy', 'failed', 'voicemail_detected'].includes(event)) {
      const tentativas = (chamada.tentativas ?? 0) + 1;
      await supabase.from('chamadas_triagem').update({
        tentativas,
        status: tentativas >= MAX_TENTATIVAS ? 'sem_contato' : 'reagendar',
        ultimo_resultado: event,
      }).eq('id', chamada.id);
      return { ok: true };
    }

    // call_ended
    await supabase.from('chamadas_triagem').update({
      duracao_segundos: duration_seconds ?? 0,
      gravacao_url: recording_url ?? null,
      transcricao: transcript ?? null,
      finalizada_em: new Date().toISOString(),
      // se a tool encerrar_triagem já rodou, ela mandou o status definitivo
      status: chamada.status === 'em_andamento' ? 'cliente_desligou' : chamada.status,
    }).eq('id', chamada.id);

    return { ok: true };
  });
}
