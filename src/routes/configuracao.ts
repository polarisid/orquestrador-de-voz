import type { FastifyInstance } from 'fastify';
import { destinoTransbordo, gravarConfig, lerConfig } from '../services/configuracao.js';
import { aplicarTransbordo, aplicarLatencia } from '../services/agente.js';

const E164 = /^\+\d{11,15}$/;
const SIP = /^sip:[^@\s]+@[^\s]+$/;
const RAMAL = /^\d{3,5}$/;

export async function rotasConfiguracao(app: FastifyInstance) {
  app.get('/configuracao', async () => ({
    transbordo: await destinoTransbordo(),
    transbordo_aplicado_em: await lerConfig('transbordo_aplicado_em'),
    latencia_streaming: Number(await lerConfig('latencia_streaming', '4')),
    latencia_turn: Number(await lerConfig('latencia_turn', '2')),
    latencia_aplicada_em: await lerConfig('latencia_aplicada_em'),
    agente_configurado: Boolean(process.env.ELEVENLABS_AGENT_ID && process.env.ELEVENLABS_API_KEY),
    servidor_sip: process.env.IFALEI_SERVIDOR ?? 'sip.ifalei.com.br',
  }));

  app.put<{ Body: { streaming?: number; turn_timeout?: number } }>(
    '/configuracao/latencia',
    async (req, reply) => {
      const streaming = Number(req.body?.streaming ?? 4);
      const turn = Number(req.body?.turn_timeout ?? 2);

      if (![0,1,2,3,4].includes(streaming) || turn < 1 || turn > 10) {
        return reply.code(400).send({
          erro: 'valor_invalido',
          mensagem: 'Streaming de 0 a 4; espera de 1 a 10 segundos.',
        });
      }

      await gravarConfig('latencia_streaming', String(streaming));
      await gravarConfig('latencia_turn', String(turn));

      try {
        const aplicado = await aplicarLatencia(streaming, turn);
        const em = await gravarConfig('latencia_aplicada_em', new Date().toISOString());
        return { ...aplicado, aplicado: true, aplicado_em: em };
      } catch (e) {
        req.log.error({ e: String(e) }, 'falha ao aplicar latencia');
        return reply.code(502).send({
          erro: 'nao_aplicado',
          mensagem: 'Salvei aqui, mas não consegui aplicar no agente da ElevenLabs.',
        });
      }
    },
  );

  app.put<{ Body: { transbordo?: string } }>('/configuracao/transbordo', async (req, reply) => {
    let destino = String(req.body?.transbordo ?? '').trim();

    // Ramal curto vira SIP URI: é assim que a central identifica o destino
    // interno, e digitar "1001" é o que o operador espera poder fazer.
    if (RAMAL.test(destino)) {
      destino = `sip:${destino}@${process.env.IFALEI_SERVIDOR ?? 'sip.ifalei.com.br'}`;
    }

    if (destino && !E164.test(destino) && !SIP.test(destino)) {
      return reply.code(400).send({
        erro: 'destino_invalido',
        mensagem: 'Use um ramal (1001), um número em E.164 (+557933000000) ou um SIP URI.',
      });
    }

    await gravarConfig('transbordo', destino);

    try {
      await aplicarTransbordo(destino);
      const em = await gravarConfig('transbordo_aplicado_em', new Date().toISOString());
      return { transbordo: destino, aplicado: true, aplicado_em: em };
    } catch (e) {
      req.log.error({ e: String(e) }, 'falha ao aplicar transbordo no agente');
      // Salvou no banco mas não chegou ao agente: o operador precisa saber,
      // senão vai achar que está transferindo e não está.
      return reply.code(502).send({
        erro: 'nao_aplicado',
        transbordo: destino,
        mensagem: 'Salvei aqui, mas não consegui aplicar no agente da ElevenLabs.',
        detalhe: String(e).slice(0, 300),
      });
    }
  });
}
