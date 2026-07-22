/**
 * Conserto pontual: troca o LLM do agente e zera o reasoning_effort.
 *
 * Use quando o atualizar-agente falhar com "Reasoning effort is not supported
 * for this LLM". Isso acontece quando o agente teve reasoning configurado (por
 * um LLM anterior, ou ajuste no painel) e o valor ficou preso — aí qualquer
 * PATCH que mande o prompt é rejeitado inteiro.
 *
 * Este script manda SÓ o mínimo, então tem menos chance de esbarrar noutro
 * campo. Depois dele, rode o atualizar-agente normal.
 *
 *   node scripts/corrigir-llm.mjs
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
if (!KEY || !AGENT) {
  console.error('Faltam ELEVENLABS_API_KEY ou ELEVENLABS_AGENT_ID no .env');
  process.exit(1);
}

const url = `https://api.elevenlabs.io/v1/convai/agents/${AGENT}`;

// Primeiro tenta com null (limpa o campo na maioria das APIs).
// Se a API insistir, manda 'none', que alguns endpoints usam como "sem esforço".
for (const valor of [null, 'none', 'low']) {
  const corpo = {
    conversation_config: {
      agent: { prompt: { llm: 'gemini-2.0-flash', reasoning_effort: valor } },
    },
  };

  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'xi-api-key': KEY },
    body: JSON.stringify(corpo),
  });

  if (r.ok) {
    console.log(`OK — LLM ajustado para gemini-2.0-flash, reasoning_effort=${JSON.stringify(valor)}`);
    console.log('Agora rode: npm run atualizar-agente');
    process.exit(0);
  }

  const txt = await r.text();
  // Se o erro não é mais sobre reasoning, paramos: é outra coisa.
  if (!txt.toLowerCase().includes('reasoning')) {
    console.error(`Falhou (${r.status}), e não é mais sobre reasoning:\n${txt.slice(0, 400)}`);
    process.exit(1);
  }
  console.log(`  tentativa reasoning_effort=${JSON.stringify(valor)} não pegou, tentando outro...`);
}

console.error('Nenhum valor de reasoning_effort foi aceito. Ajuste manualmente no painel:');
console.error('  agente > LLM: troque para Gemini 2.0 Flash, e desative "reasoning".');
process.exit(1);
