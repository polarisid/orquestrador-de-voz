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

  if (url === '/calls' && req.method === 'POST') {
    const id = `mock_${Date.now()}`;
    chamadas.set(id, json);
    console.log('\n=== CHAMADA ORIGINADA ===');
    console.log('para:', json.to, '| de:', json.from, '| tronco:', json.sip_trunk_id);
    console.log('tools:', json.agent.tools.map((t) => t.name).join(', '));
    console.log('\n--- PROMPT ENVIADO AO AGENTE ---\n');
    console.log(json.agent.system_prompt);
    console.log('\n--- fim do prompt ---');
    console.log(`\nid da chamada: ${id}\n`);
    res.end(JSON.stringify({ id }));
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
