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
      process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().split(/\s+#/)[0].trim();
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

const fluxo = process.argv[2] ?? 'triagem';

const DADOS = {
  triagem: {
    os_numero: '4181234567',
    cliente_nome: 'Maria da Silva',
    cliente_endereco: 'Rua X, 100, Farolandia, Aracaju',
    telefone: '79999998888',
    produto_modelo: 'AR12BVHZCWK',
    produto_linha: 'RAC',
    garantia: 'em_garantia',
    sintoma_declarado: 'nao gela',
  },
  retirada: {
    os_numero: '4189876543',
    cliente_nome: 'Joao Pereira',
    telefone: '79988887777',
    produto_modelo: 'RT38K5A',
    produto_linha: 'REF',
    servico_realizado: 'Troca da placa principal',
    pagamento: 'a_pagar',
    prazo_guarda: '30 dias',
  },
}[fluxo];

const { provider_call_id } = await post('/calls', { fluxo, dados: DADOS });

if (!provider_call_id) {
  console.error('chamada nao foi criada — confira a janela de horario e o .env');
  process.exit(1);
}

// Formato ElevenLabs: uma URL por tool, argumentos na raiz do corpo.
const tool = (name, args) =>
  post(`/webhooks/el/${name}`, { conversation_id: provider_call_id, ...args }, true);

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

await post('/webhooks/elevenlabs', {
  type: 'post_call_transcription',
  data: {
    conversation_id: provider_call_id,
    status: 'done',
    transcript: [{ role: 'agent', message: 'Ola, bom dia...', time_in_call_secs: 0 }],
    metadata: { call_duration_secs: 214, termination_reason: 'end_call_tool' },
    analysis: { transcript_summary: 'Cadastro corrigido, sintoma confirmado, documentos enviados.' },
  },
}, true);

console.log('\nfluxo completo. rode: npm run ver');
