import './env.js';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rotasDisparo } from './routes/disparo.js';
import { rotasRoteiro } from './routes/roteiro.js';
import { rotasConversa } from './routes/conversa.js';
import { rotasTools } from './routes/tools.js';
import { rotasEventos } from './routes/eventos.js';

const app = Fastify({ logger: true });

// Valide a assinatura do webhook do provedor antes de confiar no payload.
app.addHook('preHandler', async (req, reply) => {
  if (!req.url.startsWith('/webhooks/')) return;
  const assinatura = req.headers['x-signature'];
  if (!assinatura || assinatura !== process.env.WEBHOOK_SECRET) {
    return reply.code(401).send({ erro: 'assinatura inválida' });
  }
});

// Painel da mesa de triagem
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await app.register(fastifyStatic, { root: resolve(raiz, 'public') });

app.get('/health', async () => {
  const faltando = ['ELEVENLABS_API_KEY', 'ELEVENLABS_AGENT_ID', 'ELEVENLABS_PHONE_NUMBER_ID']
    .filter((v) => !process.env[v]);
  return { ok: true, ...(faltando.length ? { configuracao_faltando: faltando } : {}) };
});

await app.register(rotasDisparo);
await app.register(rotasRoteiro);
await app.register(rotasConversa);
await app.register(rotasTools);
await app.register(rotasEventos);

await app.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' });
