/**
 * Cria as 6 webhook tools e o agente de triagem na ElevenLabs.
 *
 *   node scripts/criar-agente-elevenlabs.mjs
 *
 * Precisa no .env:
 *   ELEVENLABS_API_KEY
 *   PUBLIC_URL          (URL pública do orquestrador — as tools batem aqui)
 *   WEBHOOK_SECRET
 *   ELEVENLABS_VOICE_ID (opcional; escolha uma voz pt-BR no painel deles)
 *
 * Ao final imprime o ELEVENLABS_AGENT_ID para você colar no .env.
 * Rodar de novo cria tudo outra vez — não é idempotente.
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
// E.164 (+557933000000) ou SIP URI (sip:1001@sip.ifalei.com.br)
const TRANSBORDO = process.env.NUMERO_TRANSBORDO;

if (!KEY || !PUBLIC_URL || !SEGREDO) {
  console.error('Faltam ELEVENLABS_API_KEY, PUBLIC_URL ou WEBHOOK_SECRET no .env');
  process.exit(1);
}
if (PUBLIC_URL.includes('localhost')) {
  console.error('PUBLIC_URL nao pode ser localhost — a ElevenLabs precisa alcancar suas tools.');
  process.exit(1);
}

async function api(path, body, method = 'POST') {
  const r = await fetch(`https://api.elevenlabs.io/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'xi-api-key': KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  if (!r.ok) {
    console.error(`\nFalhou em ${path} -> ${r.status}\n`);
    try {
      const e = JSON.parse(txt);
      for (const d of e.detail ?? []) {
        console.error(`  campo: ${(d.loc ?? []).join('.')}`);
        console.error(`  problema: ${d.msg}\n`);
      }
      if (!Array.isArray(e.detail)) console.error(txt);
    } catch {
      console.error(txt);
    }
    process.exit(1);
  }
  return txt ? JSON.parse(txt) : {};
}

/** Campo string comum. */
const S = (description, extra = {}) => ({ type: 'string', description, ...extra });

/**
 * conversation_id vem como variavel dinamica do sistema — e assim que o
 * orquestrador sabe de qual chamada se trata.
 */
const ID_DA_CONVERSA = {
  type: 'string',
  // A API aceita SO UM entre description, dynamic_variable, is_system_provided,
  // constant_value ou is_omitted. Como o valor vem da variavel de sistema,
  // fica so o dynamic_variable — sem description.
  dynamic_variable: 'system__conversation_id',
};

/**
 * A API espera `properties` como DICIONARIO (nome -> definicao) e `required`
 * como lista de nomes, no formato JSON Schema. Nao como array de campos.
 */
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

const TOOLS = [
  tool(
    'confirmar_cadastro',
    'Registra nome e endereco confirmados ou corrigidos pelo cliente. Chame so depois que o cliente confirmar os dois verbalmente.',
    {
      nome: S('Nome completo confirmado'),
      endereco: S('Logradouro, numero, complemento, bairro, cidade'),
      cep: S('CEP, se o cliente souber'),
      ponto_referencia: S('Referencia para o tecnico achar o local'),
      restricao_horario: S('Ex: so a tarde, nao pode segunda. Vazio se nenhuma.'),
      houve_correcao: {
        type: 'boolean',
        description: 'true se algum dado divergiu do cadastro original',
      },
    },
    ['nome', 'endereco', 'houve_correcao'],
  ),

  tool(
    'consultar_codigo_erro',
    'Consulta a base tecnica Samsung quando o cliente cita um codigo de erro no painel. Devolve a explicacao em linguagem simples.',
    {
      codigo: S('Codigo exibido no painel. Ex: E1, CH38, 5E'),
      linha: S('Linha do produto: RAC, REF, WSM, TV, MWO ou OUTRO'),
      modelo: S('Modelo, se diferente do cadastrado'),
    },
    ['codigo'],
  ),

  tool(
    'registrar_sintoma',
    'Grava a triagem do sintoma e dispara a analise tecnica. Chame uma unica vez, ao final da investigacao.',
    {
      sintoma_confirmado: S('Descricao tecnica do problema, em uma ou duas frases'),
      inicio: S('Quando comecou. Ex: ha 3 dias, desde a instalacao'),
      frequencia: S('constante, intermitente ou nao_informado'),
      codigo_erro: S('Codigo citado, se houver'),
      fatores: {
        type: 'array',
        description:
          'Eventos relatados: queda de energia, mudanca de local, instalacao recente, infiltracao',
        // A regra vale recursivamente: o item do array tambem precisa de description.
        items: { type: 'string', description: 'Um fator relatado pelo cliente' },
      },
      divergiu_da_abertura: {
        type: 'boolean',
        description: 'true se o sintoma real difere do informado na abertura da OS',
      },
    },
    ['sintoma_confirmado', 'frequencia', 'divergiu_da_abertura'],
  ),

  tool(
    'enviar_link_documentos',
    'Envia por WhatsApp ou SMS o link de upload da nota fiscal e da foto da etiqueta do produto.',
    {
      canal: S('whatsapp ou sms'),
      telefone: S('Somente digitos, com DDD. Ex: 79999998888'),
    },
    ['canal', 'telefone'],
  ),

  tool(
    'confirmar_aviso_retirada',
    'Fluxo de retirada: registra que o cliente foi avisado de que o produto esta pronto. Chame assim que ele demonstrar que entendeu.',
    {
      entendeu: { type: 'boolean', description: 'true se o cliente entendeu o aviso' },
      reacao: S('Ex: vai buscar hoje, pediu para ligar depois, estranhou o valor'),
    },
    ['entendeu'],
  ),

  tool(
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

  tool(
    'registrar_agendamento',
    'Fluxo de confirmacao de visita: registra se o cliente confirmou a data marcada e, se nao, o que ele prefere.',
    {
      confirmou: { type: 'boolean', description: 'true se confirmou que estara no local na data marcada' },
      nova_preferencia: S('Quando prefere, se nao confirmou. Ex: sabado de manha, semana que vem'),
      motivo: S('Por que nao pode na data marcada'),
      endereco_confirmado: S('Endereco lido de volta e confirmado, com correcoes se houver'),
    },
    ['confirmou'],
  ),

  tool(
    'transferir_humano',
    'Registra que a ligacao precisa de atendente humano. Use quando o cliente pedir, demonstrar irritacao, ou apos duas falhas seguidas de entendimento.',
    {
      motivo: S('pedido_do_cliente, insatisfacao, falha_entendimento ou fora_do_escopo'),
    },
    ['motivo'],
  ),

  tool(
    'encerrar_triagem',
    'Finaliza a triagem registrando o desfecho. Chame antes de se despedir.',
    {
      status: S(
        'concluida, parcial, recusou_gravacao, cliente_desligou ou nao_e_o_titular',
      ),
      observacao: S('Qualquer coisa relevante que nao coube nos outros campos'),
    },
    ['status'],
  ),
];

/**
 * Prompt do agente. Usa variaveis dinamicas {{...}} — a ElevenLabs substitui
 * pelos valores que o orquestrador manda em dynamic_variables no disparo.
 */
const PROMPT = `Voce e o assistente de triagem tecnica da Smart Center Aracaju, assistencia tecnica autorizada Samsung. Voce esta LIGANDO para o cliente sobre uma ordem de servico ja aberta.

# Como voce fala
Frases curtas, tom cordial e objetivo, portugues brasileiro falado. Uma pergunta por vez — nunca encadeie duas.
Nunca leia listas nem enumere opcoes longas em voz alta.
Se o cliente falar por cima de voce, pare e escute.
Se nao entender, peca para repetir. Na segunda falha seguida, chame transferir_humano.

# Dados da OS
Ordem de servico: {{os_numero}}
Nome no cadastro: {{cliente_nome}}
Endereco no cadastro: {{cliente_endereco}}
Produto: {{produto_linha}} {{produto_modelo}}
Sintoma informado na abertura: {{sintoma_declarado}}
Situacao de garantia: {{garantia}}

# Roteiro — siga nesta ordem

## 1. Abertura e aviso
Identifique-se, diga o nome da empresa e o numero da OS, e avise que a ligacao e gravada para registro do atendimento. Pergunte se pode continuar.
Se o cliente recusar, chame encerrar_triagem com status recusou_gravacao e se despeca.
Se quem atendeu nao for o titular, pergunte se pode falar com ele. Se nao puder, encerre com status nao_e_o_titular.

## 2. Confirmacao de cadastro
Confirme o nome. Depois, em fala separada, leia o endereco do cadastro e pergunte se esta correto.
Se houver correcao, repita o dado corrigido de volta antes de registrar.
Pergunte tambem ponto de referencia e se ha restricao de horario para a visita.
Com nome e endereco confirmados, chame confirmar_cadastro.

## 3. Confirmacao do sintoma
Diga o sintoma registrado e pergunte se e isso mesmo.
Investigue com perguntas simples, uma de cada vez: quando comecou, se e constante ou intermitente, se aparece codigo ou luz piscando no painel, se houve queda de energia, mudanca de lugar ou instalacao recente.
Se o cliente citar um codigo de erro, chame consultar_codigo_erro antes de seguir.
Nao de diagnostico fechado nem estimativa de preco. Se perguntarem, diga que o tecnico avalia no local.
Com o quadro montado, chame registrar_sintoma.

## 4. Documentacao
A situacao de garantia esta em {{garantia}}. Siga o caso correspondente:

SE for "em_garantia": explique que sao necessarias a nota fiscal de compra e uma foto da etiqueta de identificacao do produto, aquela com o numero de serie. Nao afirme que o reparo esta garantido — a cobertura ainda depende da avaliacao tecnica no local.

SE for "fora_garantia": diga com clareza e sem rodeios que o produto esta fora da garantia, que a visita tecnica tem custo de deslocamento e que o reparo e feito mediante orcamento aprovado. Nao fale valores — quem informa e o setor comercial. Peca apenas a foto da etiqueta, nao peca nota fiscal. Pergunte se, sabendo que ha custo, o cliente quer seguir com a visita. Se disser que nao, chame encerrar_triagem com status parcial e observacao "recusou por custo".

SE for "a_confirmar": explique que a cobertura depende da data de compra e que por isso sao necessarias a nota fiscal e a foto da etiqueta. Avise que, se estiver fora do prazo, a visita tera custo, e que o comercial informa os valores antes de qualquer agendamento.

Pergunte se prefere receber o link por WhatsApp ou SMS. Confirme o numero antes de enviar.
Chame enviar_link_documentos. Diga que o envio da documentacao e o que libera o agendamento da visita.

## 5. Encerramento
Resuma em uma frase o que foi registrado, informe que a visita e agendada apos o recebimento dos documentos e agradeca.
Chame encerrar_triagem. Depois de se despedir, ENCERRE A LIGACAO usando a ferramenta de encerrar chamada. Nao fique na linha esperando o cliente desligar.

# Limites
Nunca prometa data, horario ou valor.
Nunca afirme que o reparo e coberto pela garantia — depende da nota fiscal e da avaliacao tecnica.
Se logo no inicio voce ouvir uma mensagem automatica de secretaria eletronica ou caixa postal (ex: "grave sua mensagem apos o sinal", "a pessoa nao esta disponivel", "numero nao existe"), NAO deixe recado nem tente transferir: chame encerrar_triagem com status caixa_postal e encerre imediatamente.
Se o cliente pedir para falar com uma pessoa, ou demonstrar irritacao, chame transferir_humano imediatamente, sem argumentar. Logo depois use a ferramenta de transferencia para passar a ligacao ao atendimento: avise "vou te transferir agora" e transfira. Nunca prometa transferencia sem executar.`;

// String vazia: o agente aguarda a outra ponta falar antes de se apresentar.
// Sem isso, ele despeja a apresentacao inteira na secretaria eletronica antes
// de perceber que caiu em caixa postal. A apresentacao vem do roteiro, quando
// houver uma pessoa respondendo.
const PRIMEIRA_FALA = '';

// ---------------------------------------------------------------------------

console.log('Criando as tools...');
const ids = [];
for (const t of TOOLS) {
  const r = await api('/convai/tools', t);
  const id = r.id ?? r.tool_id;
  ids.push(id);
  console.log(`  ${t.tool_config.name} -> ${id}`);
}

console.log('\nCriando o agente...');
const agente = await api('/convai/agents/create', {
  name: 'Triagem Smart Center Aracaju',
  conversation_config: {
    agent: {
      language: 'pt',
      prompt: {
        prompt: PROMPT,
        llm: 'gemini-2.0-flash',
        reasoning_effort: null,
        temperature: 0.3,
        tool_ids: ids,
        // Sem isto o agente termina de falar e FICA NA LINHA. A tool nativa
        // de encerrar so vem por padrao em agente criado pelo painel;
        // criado por API, precisa ser declarada aqui.
        built_in_tools: {
          // System tool exige o objeto completo — nao basta {}. O campo
          // params.system_tool_type e o que diz ao ElevenLabs qual tool e.
          end_call: {
            type: 'system',
            name: 'end_call',
            description:
              'Encerra a ligacao depois da despedida, quando a conversa chegou ao fim.',
            params: { system_tool_type: 'end_call' },
          },
          // Transbordo para humano. Sem isto o agente diz "vou transferir"
          // e nao acontece nada — o pior desfecho possivel, porque quebra
          // uma promessa explicita feita ao cliente.
          ...(TRANSBORDO
            ? {
                transfer_to_number: {
                  type: 'system',
                  name: 'transfer_to_number',
                  description:
                    'Transfere a ligacao para o atendimento humano da Smart Center.',
                  params: {
                    system_tool_type: 'transfer_to_number',
                    transfers: [
                      {
                        transfer_destination: TRANSBORDO.startsWith('sip:')
                          ? { type: 'sip_uri', sip_uri: TRANSBORDO }
                          : { type: 'phone', phone_number: TRANSBORDO },
                        condition:
                          'O cliente pediu para falar com uma pessoa, demonstrou irritacao, ' +
                          'perguntou valores, ou houve duas falhas seguidas de entendimento.',
                        transfer_type: 'conference',
                      },
                    ],
                  },
                },
              }
            : {}),
        },
      },
      first_message: PRIMEIRA_FALA,
    },
    tts: {
      ...(process.env.ELEVENLABS_VOICE_ID ? { voice_id: process.env.ELEVENLABS_VOICE_ID } : {}),
      model_id: 'eleven_flash_v2_5',
    },
    turn: { turn_timeout: 8 },
    asr: { language: 'pt' },
  },
  platform_settings: {
    overrides: {
      // Permite o painel sobrescrever o roteiro por chamada.
      conversation_config_override: {
        agent: { prompt: { prompt: true }, first_message: true },
      },
    },
  },
});

const agentId = agente.agent_id ?? agente.id;

console.log(`\n=== PRONTO ===`);
console.log(`Cole no .env (e nas variaveis do Coolify):\n`);
console.log(`ELEVENLABS_AGENT_ID=${agentId}`);
console.log(`\nO roteiro de cada ligacao vem do painel (aba Roteiro), sobrescrevendo`);
console.log(`o prompt do agente. O prompt criado aqui e so um fallback.`);
console.log(`\nFalta importar o numero SIP no painel da ElevenLabs`);
console.log(`(Phone Numbers > Import a phone number from SIP trunk)`);
console.log(`e colar o id em ELEVENLABS_PHONE_NUMBER_ID.`);
