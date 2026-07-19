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
