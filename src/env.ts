/**
 * Carrega o .env sem depender do --env-file do Node, que nem sempre é
 * repassado pelo tsx (principalmente no Windows). Zero dependências.
 *
 * DEVE ser o primeiro import do index.ts: em ESM os módulos são avaliados
 * na ordem dos imports, e vários services leem process.env no topo.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const arquivo = resolve(process.cwd(), '.env');

if (existsSync(arquivo)) {
  // remove BOM (Bloco de Notas do Windows) e normaliza CRLF
  const bruto = readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

  for (const linha of bruto.split('\n')) {
    const l = linha.trim();
    if (!l || l.startsWith('#')) continue;

    const i = l.indexOf('=');
    if (i === -1) continue;

    const chave = l.slice(0, i).trim();
    let valor = l.slice(i + 1).trim();
    // comentário no fim da linha, quando o valor não está entre aspas
    if (!/^["']/.test(valor)) valor = valor.split(/\s+#/)[0].trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }

    // variável já definida no shell tem prioridade
    if (process.env[chave] === undefined) process.env[chave] = valor;
  }
  console.log(`[env] .env carregado`);
} else if (process.env.NODE_ENV === 'production') {
  // Em produção (Coolify, Docker) as variáveis vêm do ambiente — isto é o esperado.
  console.log('[env] sem .env; usando variáveis do ambiente');
} else {
  console.warn(`[env] .env NAO ENCONTRADO em ${arquivo} — usando defaults`);
}

console.log(`[env] DRY_RUN=${process.env.DRY_RUN ?? '(vazio)'}`);
