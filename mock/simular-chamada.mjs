/**
 * Simula a conversa inteira: dispara a chamada e depois envia as tool calls
 * na ordem do roteiro, como o agente de voz faria.
 *
 *   node mock/simular-chamada.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
if (existsSync('.env')) {
  for (const l of readFileSync('.env', 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0 && process.env[t.slice(0, i).trim()] === undefined)
      process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

const ORQ = 'http://localhost:3001';
const SEGREDO = process.env.WEBHOOK_SECRET ?? 'troque-isto';

const post = async (path, body, comSegredo = false) => {
  const r = await fetch(ORQ + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(comSegredo ? { 'x-signature': SEGREDO } : {}),
    },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  console.log(`${path} -> ${r.status} ${txt}`);
  try { return JSON.parse(txt); } catch { return {}; }
};

const { provider_call_id } = await post('/calls', {
  os_numero: '4181234567',
  cliente_nome: 'Maria da Silva',
  cliente_endereco: 'Rua X, 100, Farolandia, Aracaju',
  telefone: '79999998888',
  produto_modelo: 'AR12BVHZCWK',
  produto_linha: 'RAC',
  sintoma_declarado: 'nao gela',
});

if (!provider_call_id) {
  console.error('chamada nao foi criada — confira a janela de horario e o .env');
  process.exit(1);
}

const tool = (name, args) =>
  post('/webhooks/tool-call', { call_id: provider_call_id, name, args }, true);

await post('/webhooks/call-event', { call_id: provider_call_id, event: 'call_answered' }, true);

await tool('confirmar_cadastro', {
  nome: 'Maria da Silva Santos',
  endereco: 'Rua X, 100, apto 302, Farolandia, Aracaju',
  cep: '49030000',
  ponto_referencia: 'em frente a padaria',
  restricao_horario: 'so a tarde',
  houve_correcao: true,
});

await tool('consultar_codigo_erro', { codigo: 'E1', linha: 'RAC', modelo: 'AR12BVHZCWK' });

await tool('registrar_sintoma', {
  sintoma_confirmado: 'Unidade interna liga mas nao resfria; codigo E1 no painel',
  inicio: 'ha 3 dias',
  frequencia: 'constante',
  codigo_erro: 'E1',
  fatores: ['queda de energia'],
  divergiu_da_abertura: false,
});

await tool('enviar_link_documentos', { canal: 'sms', telefone: '79999998888' });

await tool('encerrar_triagem', { status: 'concluida', observacao: 'cliente colaborativo' });

await post('/webhooks/call-event', {
  call_id: provider_call_id,
  event: 'call_ended',
  duration_seconds: 214,
  recording_url: 'https://exemplo/gravacao.mp3',
  transcript: [{ role: 'agent', text: 'Bom dia...', ts: 0 }],
}, true);

console.log('\nfluxo completo. rode: npm run ver');
