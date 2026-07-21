/**
 * Provedor de voz FALSO. Sobe em :4000 e responde aos endpoints que o
 * voice-provider.ts chama. Serve para testar o orquestrador sem telefonia,
 * sem crédito e sem ligar para ninguém.
 *
 *   node mock/provedor-falso.mjs
 */
import { createServer } from 'node:http';

const chamadas = new Map();

createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const json = body ? JSON.parse(body) : {};
  const url = req.url ?? '';

  res.setHeader('content-type', 'application/json');

  if (url === '/convai/sip-trunk/outbound-call' && req.method === 'POST') {
    const id = `conv_${Date.now()}`;
    chamadas.set(id, json);
    const ini = json.conversation_initiation_client_data ?? {};
    console.log('\n=== CHAMADA ORIGINADA ===');
    console.log('para:', json.to_number);
    console.log('agente:', json.agent_id, '| numero:', json.agent_phone_number_id);
    console.log('\n--- VARIAVEIS DINAMICAS ---');
    console.log(JSON.stringify(ini.dynamic_variables ?? {}, null, 2));
    const ov = ini.conversation_config_override?.agent?.prompt?.prompt;
    if (ov) {
      console.log('\n--- ROTEIRO SOBRESCRITO PELO PAINEL ---\n');
      console.log(ov);
    } else {
      console.log('\n(sem override — o agente usa o prompt padrao dele)');
    }
    console.log(`\nconversation_id: ${id}\n`);
    res.end(JSON.stringify({ success: true, conversation_id: id, sip_call_id: 'sip_' + id }));
    return;
  }

  // PATCH /convai/agents/<id> — atualizacao do agente
  if (req.method === 'PATCH' && /\/convai\/agents\//.test(url)) {
    const t = json.conversation_config?.agent?.prompt?.built_in_tools ?? {};
    console.log('\n=== AGENTE ATUALIZADO ===');
    console.log('system tools:', Object.keys(t).join(', ') || '(nenhuma)');
    const tr = t.transfer_to_number?.params?.transfers?.[0]?.transfer_destination;
    if (tr) console.log('transbordo:', JSON.stringify(tr));
    res.end(JSON.stringify({ agent_id: 'mock_agent' }));
    return;
  }

  // GET /convai/conversations/<id> — transcricao falsa
  if (req.method === 'GET' && /\/convai\/conversations\/[^/]+$/.test(url)) {
    res.end(JSON.stringify({
      transcript: [
        { role: 'agent',  message: 'Ola! Aqui e o assistente da Smart Center Aracaju. Estou ligando sobre a ordem de servico 4181234567. Posso continuar?', time_in_call_secs: 0 },
        { role: 'user',   message: 'Pode sim.', time_in_call_secs: 8 },
        { role: 'agent',  message: 'O nome no cadastro esta como Maria da Silva. Esta correto?', time_in_call_secs: 11 },
        { role: 'user',   message: 'E Maria da Silva Santos, na verdade.', time_in_call_secs: 16 },
        { role: 'agent',  message: 'Anotado. E o endereco: Rua X, numero 100, Farolandia. Confere?', time_in_call_secs: 21 },
        { role: 'user',   message: 'Falta o apartamento, 302.', time_in_call_secs: 28 },
      ],
      metadata: { call_duration_secs: 214, termination_reason: 'end_call_tool' },
      analysis: { transcript_summary: 'Cadastro corrigido (complemento e sobrenome). Sintoma confirmado como falha de refrigeracao com codigo E1. Documentos enviados por SMS.' },
    }));
    return;
  }

  // GET /convai/conversations/<id>/audio — bytes quaisquer, so para o player existir
  if (req.method === 'GET' && url.endsWith('/audio')) {
    res.setHeader('content-type', 'audio/mpeg');
    res.end(Buffer.alloc(2048));
    return;
  }

  if (url.endsWith('/transfer')) {
    console.log('>> TRANSFERIU para', json.to);
    res.end('{}');
    return;
  }

  if (url.endsWith('/end')) {
    console.log('>> ENCERROU a chamada');
    res.end('{}');
    return;
  }

  res.statusCode = 404;
  res.end('{}');
}).listen(4000, () => console.log('provedor falso em http://localhost:4000'));
