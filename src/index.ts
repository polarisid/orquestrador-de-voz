import './env.js';
import Fastify from 'fastify';
import { rotasDisparo } from './routes/disparo.js';
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

app.get('/health', async () => ({ ok: true }));

await app.register(rotasDisparo);
await app.register(rotasTools);
await app.register(rotasEventos);

await app.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' });
