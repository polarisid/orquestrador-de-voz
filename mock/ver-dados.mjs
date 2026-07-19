/** Imprime a última chamada gravada no store local. */
import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync('dados/store.json', 'utf8'));
const c = (d.chamadas_triagem ?? []).at(-1);
if (!c) { console.log('nenhuma chamada ainda.'); process.exit(0); }
const campos = ['os_numero','status','etapa','cadastro_nome','cadastro_endereco','restricao_horario','cadastro_corrigido','sintoma_confirmado','codigo_erro','sintoma_frequencia','doc_canal','duracao_segundos'];
for (const k of campos) console.log(k.padEnd(22), c[k] ?? '-');
console.log('\ntriagem_analise:');
console.log(JSON.stringify(c.triagem_analise, null, 2));
