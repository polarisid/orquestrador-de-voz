/**
 * Cria UMA tool (ou algumas) na ElevenLabs, sem tocar nas que ja existem.
 *
 *   node scripts/criar-tool.mjs registrar_agendamento
 *   node scripts/criar-tool.mjs                        # lista as disponiveis
 *
 * Usa o mesmo formato que o criar-agente ja provou funcionar na API — o
 * editor de JSON do painel usa um schema diferente, e nao vale a pena
 * perseguir os dois.
 *
 * Depois de criar, VINCULE a tool ao agente no painel: criar nao vincula.
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
const PUBLIC_URL = process.env.PUBLIC_URL;
const SEGREDO = process.env.WEBHOOK_SECRET;

if (!KEY || !PUBLIC_URL || !SEGREDO) {
  console.error('Faltam ELEVENLABS_API_KEY, PUBLIC_URL ou WEBHOOK_SECRET no .env');
  process.exit(1);
}
if (PUBLIC_URL.includes('localhost')) {
  console.error('PUBLIC_URL nao pode ser localhost — a ElevenLabs precisa alcancar suas tools.');
  process.exit(1);
}

const S = (description) => ({ type: 'string', description });
const ID_DA_CONVERSA = { type: 'string', dynamic_variable: 'system__conversation_id' };

function tool(nome, descricao, propriedades, obrigatorios) {
  return {
    tool_config: {
      type: 'webhook',
      name: nome,
      description: descricao,
      response_timeout_secs: 15,
      api_schema: {
        url: `${PUBLIC_URL}/webhooks/el/${nome}`,
        method: 'POST',
        request_headers: { 'x-signature': SEGREDO },
        request_body_schema: {
          type: 'object',
          description: descricao,
          properties: { conversation_id: ID_DA_CONVERSA, ...propriedades },
          required: ['conversation_id', ...obrigatorios],
        },
      },
    },
  };
}

const CATALOGO = {
  registrar_agendamento: tool(
    'registrar_agendamento',
    'Fluxo de confirmacao de visita: registra se o cliente confirmou a data marcada e, se nao, o que ele prefere. Chame ao final da etapa 2.',
    {
      confirmou: {
        type: 'boolean',
        description: 'true se o cliente confirmou que estara no local na data marcada',
      },
      nova_preferencia: S('Quando prefere, se nao confirmou. Ex: sabado de manha, semana que vem'),
      motivo: S('Por que nao pode na data marcada. Ex: vai viajar, trabalha o dia todo'),
      endereco_confirmado: S('Endereco lido de volta e confirmado, com correcoes se houver'),
    },
    ['confirmou'],
  ),

  confirmar_aviso_retirada: tool(
    'confirmar_aviso_retirada',
    'Fluxo de retirada: registra que o cliente foi avisado de que o produto esta pronto.',
    {
      entendeu: { type: 'boolean', description: 'true se o cliente entendeu o aviso' },
      reacao: S('Ex: vai buscar hoje, pediu para ligar depois, estranhou o valor'),
    },
    ['entendeu'],
  ),

  registrar_retirada: tool(
    'registrar_retirada',
    'Fluxo de retirada: grava quem vai buscar o produto e quando.',
    {
      quem_retira: S('Nome completo de quem vai buscar'),
      e_o_titular: { type: 'boolean', description: 'true se quem retira e o proprio cliente' },
      previsao: S('Quando pretende vir. Ex: sabado, essa semana, nao sabe ainda'),
      observacao: S('Qualquer detalhe relevante'),
    },
    ['quem_retira', 'e_o_titular'],
  ),
};

const pedidas = process.argv.slice(2);

if (!pedidas.length) {
  console.log('Informe uma ou mais tools. Disponiveis:\n');
  for (const n of Object.keys(CATALOGO)) console.log('  ' + n);
  console.log('\nExemplo: node scripts/criar-tool.mjs registrar_agendamento');
  process.exit(0);
}

// Evita duplicata: criar de novo gera outra tool com o mesmo nome, e depois
// voce nao sabe qual esta vinculada ao agente.
const lista = await (await fetch('https://api.elevenlabs.io/v1/convai/tools', {
  headers: { 'xi-api-key': KEY },
})).json();

const existentes = new Set(
  (lista?.tools ?? []).map((t) => t?.tool_config?.name ?? t?.name).filter(Boolean),
);

for (const nome of pedidas) {
  const t = CATALOGO[nome];
  if (!t) {
    console.error(`  ${nome}: nao existe no catalogo deste script`);
    continue;
  }
  if (existentes.has(nome)) {
    console.log(`  ${nome}: ja existe, pulando`);
    continue;
  }

  const r = await fetch('https://api.elevenlabs.io/v1/convai/tools', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': KEY },
    body: JSON.stringify(t),
  });
  const txt = await r.text();

  if (!r.ok) {
    console.error(`\n  ${nome}: falhou (${r.status})`);
    try {
      const e = JSON.parse(txt);
      for (const d of e.detail ?? []) {
        console.error(`    campo: ${(d.loc ?? []).join('.')}`);
        console.error(`    problema: ${d.msg}`);
      }
      if (!Array.isArray(e.detail)) console.error('    ' + txt);
    } catch {
      console.error('    ' + txt);
    }
    continue;
  }

  const criada = JSON.parse(txt);
  console.log(`  ${nome}: criada (${criada.id ?? criada.tool_id})`);
}

console.log('\nFalta VINCULAR ao agente: painel > seu agente > Tools > adicione a tool.');
console.log('Criar a tool nao a vincula automaticamente.');
