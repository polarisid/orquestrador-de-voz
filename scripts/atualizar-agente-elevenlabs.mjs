/**
 * Atualiza o agente que ja existe: idioma, voz e prompt.
 * Use quando o agente falar no idioma errado ou quando voce mexer no roteiro.
 *
 *   node scripts/atualizar-agente-elevenlabs.mjs
 *
 * Nao cria nada novo — so faz PATCH no ELEVENLABS_AGENT_ID do .env.
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
const VOICE = process.env.ELEVENLABS_VOICE_ID;
const TRANSBORDO = process.env.NUMERO_TRANSBORDO;

if (!KEY || !AGENT) {
  console.error('Faltam ELEVENLABS_API_KEY ou ELEVENLABS_AGENT_ID no .env');
  process.exit(1);
}

/**
 * A instrucao de idioma vai NO TOPO do prompt, nao so no campo language.
 * Modelo com prompt em portugues as vezes responde em ingles se a primeira
 * fala do cliente for ambigua; a ordem explicita resolve.
 */
const PROMPT = `IDIOMA: fale SEMPRE em portugues do Brasil. Nunca responda em ingles nem em espanhol, mesmo que o cliente use palavras de outro idioma ou que voce nao entenda o que foi dito. Se nao entender, peca para repetir — em portugues.

Voce e o assistente de triagem tecnica da Smart Center Aracaju, assistencia tecnica autorizada Samsung. Voce esta LIGANDO para o cliente sobre uma ordem de servico ja aberta.

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

// VAZIO de proposito. Se o agente falar automaticamente ao conectar, ele
// atropela a caixa postal — fala por cima de "grave sua mensagem". Vazio faz
// ele ESPERAR a outra ponta falar primeiro: se for "alo" de gente, ele se
// apresenta (o roteiro manda); se for gravacao, ele encerra. Isso resolve o
// caso do print, onde o agente comecou a conversa com a secretaria eletronica.
const PRIMEIRA_FALA = '';

const corpo = {
  conversation_config: {
    agent: {
      language: 'pt',
      // String vazia faz o agente aguardar a outra ponta antes de falar.
      first_message: PRIMEIRA_FALA,
      // Garante que a abertura do roteiro (apresentacao) seja usada quando
      // for gente atendendo, mesmo com first_message vazio.
      prompt: {
        prompt: PROMPT,
        // LLM mais rapido disponivel. O gargalo de latencia mais comum e o
        // TAMANHO da resposta: 500 caracteres levam 4-6x mais para virar audio
        // que 80. max_tokens baixo corta isso na fonte, alem do roteiro ja
        // pedir frases curtas.
        llm: 'gemini-2.0-flash',
        temperature: 0.2,
        max_tokens: 250,
        // O gemini-flash nao suporta esforco de raciocinio. Se o agente ja teve
        // isso configurado (outro LLM antes, ou ajuste no painel), o valor fica
        // gravado e a API rejeita o PATCH inteiro com "Reasoning effort is not
        // supported for this LLM". Zerar aqui limpa o campo junto.
        reasoning_effort: null,
        // Garante a tool nativa de encerrar, que nao vem em agente criado por API.
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
    },
    asr: { language: 'pt' },
    tts: {
      ...(VOICE ? { voice_id: VOICE } : {}),
      model_id: 'eleven_flash_v2_5',
      // Maxima prioridade a velocidade (0-4). 4 e o mais rapido; pode
      // deixar a primeira silaba levemente menos suave, aceitavel numa
      // ligacao onde responder rapido importa mais que perfeicao de audio.
      optimize_streaming_latency: 4,
    },
    // Quanto o agente espera de silencio antes de assumir que o cliente
    // terminou de falar. Mais baixo = responde mais rapido, mas corta quem
    // fala pausado. 0.5s e um meio-termo bom para telefonia brasileira.
    // turn_timeout menor = o agente comeca a responder mais cedo depois que
    // o cliente para de falar. 2s corta menos que valores agressivos, mas ja
    // e bem mais rapido que os 7s anteriores.
    turn: { turn_timeout: 2, silence_end_call_timeout: 20, mode: 'turn' },
  },
};

async function enviar(body) {
  const r = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'xi-api-key': KEY },
    body: JSON.stringify(body),
  });
  return { ok: r.ok, status: r.status, txt: await r.text() };
}

let { ok, status, txt } = await enviar(corpo);

// O transbordo e o pedaco com schema mais instavel. Se ele derrubar o PATCH,
// tenta de novo sem ele: melhor ter o encerramento funcionando do que nada.
if (!ok && TRANSBORDO) {
  console.log('Falhou com o transbordo; tentando so com o encerramento...\n');
  delete corpo.conversation_config.agent.prompt.built_in_tools.transfer_to_number;
  ({ ok, status, txt } = await enviar(corpo));
  if (ok) console.log('AVISO: transbordo NAO configurado. Configure em Tools no painel.\n');
}

const r = { ok, status };
if (!r.ok) {
  console.error(`Falhou: ${r.status}`);
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

console.log('Agente atualizado.');
console.log(`  idioma: pt`);
console.log(`  voz: ${VOICE || '(padrao — configure ELEVENLABS_VOICE_ID)'}`);
console.log(`  transbordo: ${TRANSBORDO || '(desligado — configure NUMERO_TRANSBORDO)'}`);
console.log('\nA proxima ligacao ja usa a versao nova. Nao precisa redeploy.');
