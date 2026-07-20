import type { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase.js';
import { voz } from '../services/voice-provider.js';
import { normalizar } from '../services/transcricao.js';

/**
 * Transcrição e áudio vêm da ElevenLabs sob demanda, não do webhook.
 * Assim o painel funciona mesmo antes de o webhook pós-chamada estar
 * configurado — e continua funcionando se um webhook se perder.
 *
 * A transcrição é gravada no banco na primeira leitura, então a segunda
 * abertura do mesmo cartão não custa nada.
 */
export async function rotasConversa(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/calls/:id/transcricao', async (req, reply) => {
    const { data: chamada } = await supabase
      .from('chamadas_triagem')
      .select('id, provider_call_id, transcricao, resumo, duracao_segundos, status')
      .eq('id', req.params.id)
      .single();

    if (!chamada) return reply.code(404).send({ erro: 'chamada não encontrada' });

    // Já temos em cache e a chamada terminou: devolve direto.
    if (chamada.transcricao && chamada.status !== 'em_andamento') {
      return {
        transcricao: chamada.transcricao,
        resumo: chamada.resumo,
        duracao_segundos: chamada.duracao_segundos,
      };
    }

    try {
      const c: any = await voz.conversa(chamada.provider_call_id);
      const transcricao = normalizar(c.transcript);
      const resumo = c.analysis?.transcript_summary ?? null;
      const duracao = c.metadata?.call_duration_secs ?? chamada.duracao_segundos ?? 0;

      await supabase
        .from('chamadas_triagem')
        .update({ transcricao, resumo, duracao_segundos: duracao })
        .eq('id', chamada.id);

      return { transcricao, resumo, duracao_segundos: duracao };
    } catch (e) {
      req.log.error({ e }, 'falha ao buscar transcricao');
      return reply.code(502).send({ erro: 'não consegui buscar a transcrição agora' });
    }
  });

  app.get<{ Params: { id: string } }>('/calls/:id/audio', async (req, reply) => {
    const { data: chamada } = await supabase
      .from('chamadas_triagem')
      .select('provider_call_id')
      .eq('id', req.params.id)
      .single();

    if (!chamada) return reply.code(404).send({ erro: 'chamada não encontrada' });

    try {
      const bytes = await voz.audio(chamada.provider_call_id);
      return reply.type('audio/mpeg').send(Buffer.from(bytes));
    } catch (e) {
      req.log.error({ e }, 'falha ao buscar audio');
      return reply.code(502).send({ erro: 'áudio indisponível' });
    }
  });
}
