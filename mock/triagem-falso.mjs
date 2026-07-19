/**
 * Triagem AI FALSO. Sobe em :4001. Substitua pelo seu Next.js real quando
 * os endpoints /api/codigos-erro/lookup e /api/triagem/analisar existirem.
 */
import { createServer } from 'node:http';

createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const json = body ? JSON.parse(body) : {};
  res.setHeader('content-type', 'application/json');

  if (req.url === '/api/codigos-erro/lookup') {
    console.log('>> lookup código:', json.codigo, json.linha);
    res.end(JSON.stringify({
      descricao: 'Falha de comunicação entre unidade interna e externa',
      descricaoLeiga: 'Esse código indica que as duas partes do aparelho pararam de se comunicar. O técnico precisa verificar a fiação.',
      causas: ['cabo de interligação', 'placa da evaporadora'],
    }));
    return;
  }

  if (req.url === '/api/triagem/analisar') {
    console.log('>> analisar sintoma:', json.sintoma);
    res.end(JSON.stringify({
      hipoteses: [{ causa: 'cabo de interligação rompido', confianca: 0.62 }],
      pecas_provaveis: ['DB93-XXXXX'],
      boletins: ['IT-AC-135'],
      recomendacao_tecnico: 'Medir continuidade do cabo antes de trocar placa.',
    }));
    return;
  }

  res.statusCode = 404;
  res.end('{}');
}).listen(4001, () => console.log('triagem falso em http://localhost:4001'));
