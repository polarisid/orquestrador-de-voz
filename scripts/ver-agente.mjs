/**
 * Mostra o que está REALMENTE configurado no agente na ElevenLabs.
 *
 * Útil quando o comportamento não bate com o esperado: aqui você vê a
 * first_message, o LLM, o eagerness e as system tools que estão em vigor
 * agora — sem adivinhar se o último atualizar-agente pegou.
 *
 *   node scripts/ver-agente.mjs
 */
import { readFileSync, existsSync } from 'node:fs';

if (existsSync('.env')) {
  for (const l of readFileSync('.env', 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0 && process.env[t.slice(0, i).trim()] === undefined)
      process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().split(/\s+#/)[0].trim();
  }
}

const KEY = process.env.ELEVENLABS_API_KEY;
const AGENT = process.env.ELEVENLABS_AGENT_ID;
if (!KEY || !AGENT) { console.error('Faltam ELEVENLABS_API_KEY ou ELEVENLABS_AGENT_ID'); process.exit(1); }

const r = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT}`, {
  headers: { 'xi-api-key': KEY },
});
if (!r.ok) { console.error(`Falhou (${r.status}): ${(await r.text()).slice(0, 300)}`); process.exit(1); }

const a = await r.json();
const cfg = a.conversation_config ?? {};
const agent = cfg.agent ?? {};
const prompt = agent.prompt ?? {};

const fm = agent.first_message ?? '';
console.log('\n=== AGENTE EM VIGOR ===');
console.log('nome:', a.name);
console.log('LLM:', prompt.llm);
console.log('reasoning_effort:', prompt.reasoning_effort ?? '(nenhum)');
console.log('eagerness:', agent.turn?.turn_eagerness ?? '(padrão)');
console.log('turn_timeout:', agent.turn?.turn_timeout);
console.log('\nfirst_message:', fm === '' ? '(vazia — o agente espera o cliente falar) ✓' : `"${fm}"`);
if (fm !== '') {
  console.log('\n  ATENCAO: first_message NAO esta vazia. Se o roteiro tambem manda o');
  console.log('  agente se apresentar, ele se apresenta DUAS VEZES. Rode:');
  console.log('    npm run atualizar-agente');
}
const tools = Object.keys(prompt.built_in_tools ?? {});
console.log('\nsystem tools:', tools.length ? tools.join(', ') : '(nenhuma)');
if (!tools.includes('end_call')) console.log('  ATENCAO: sem end_call — o agente nao desliga sozinho.');
console.log('');
