import './env.js';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rotasDisparo } from './routes/disparo.js';
import { rotasRoteiro } from './routes/roteiro.js';
import { rotasConversa } from './routes/conversa.js';
import { authAtiva, validarToken } from './services/auth.js';
import { iniciarReconciliacao } from './services/reconciliar.js';
import { rotasEscuta } from './routes/escuta.js';
import { registrarApp } from './services/escuta.js';
import fastifyWebsocket from '@fastify/websocket';
import { rotasTools } from './routes/tools.js';
import { rotasEventos } from './routes/eventos.js';

const app = Fastify({ logger: true });

// Webhooks autenticam por assinatura compartilhada, não por login.
app.addHook('preHandler', async (req, reply) => {
  if (!req.url.startsWith('/webhooks/')) return;
  const assinatura = req.headers['x-signature'];
  if (!assinatura || assinatura !== process.env.WEBHOOK_SECRET) {
    return reply.code(401).send({ erro: 'assinatura inválida' });
  }
});

/** Rotas que nunca exigem login. */
const LIVRE = ['/health', '/config', '/login.html', '/webhooks/', '/escuta/'];

// Login do painel. Só liga quando o Supabase está configurado.
app.addHook('preHandler', async (req, reply) => {
  if (!authAtiva()) return;
  const url = req.url.split('?')[0];
  if (LIVRE.some((p) => url === p || url.startsWith(p))) return;
  // Arquivos estáticos passam; o próprio index.html redireciona para o login.
  if (/\.(html|css|js|ico|png|svg|woff2?)$/.test(url) || url === '/') return;

  const cab = req.headers.authorization ?? '';
  const token = cab.startsWith('Bearer ') ? cab.slice(7) : '';
  if (!token) return reply.code(401).send({ erro: 'nao_autenticado' });

  const usuario = await validarToken(token);
  if (!usuario) return reply.code(401).send({ erro: 'nao_autenticado' });

  (req as any).usuario = usuario;
});

/** O navegador precisa da URL e da chave anon para falar com o Supabase. */
app.get('/config', async () => ({
  auth: authAtiva(),
  supabase_url: process.env.SUPABASE_URL ?? null,
  supabase_anon_key: process.env.SUPABASE_ANON_KEY ?? null,
}));

// Painel da mesa de triagem
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await app.register(fastifyWebsocket);
await app.register(fastifyStatic, { root: resolve(raiz, 'public') });

app.get('/health', async () => {
  const faltando = ['ELEVENLABS_API_KEY', 'ELEVENLABS_AGENT_ID', 'ELEVENLABS_PHONE_NUMBER_ID']
    .filter((v) => !process.env[v]);
  return { ok: true, ...(faltando.length ? { configuracao_faltando: faltando } : {}) };
});

await app.register(rotasDisparo);
await app.register(rotasRoteiro);
await app.register(rotasConversa);
await app.register(rotasEscuta);
await app.register(rotasTools);
await app.register(rotasEventos);

iniciarReconciliacao(app.log);
registrarApp(app.log);

await app.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' });
