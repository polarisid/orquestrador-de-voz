/**
 * Importa o numero SIP na ElevenLabs sem passar pelo painel.
 *
 *   node scripts/importar-numero-elevenlabs.mjs
 *
 * Precisa no .env (raiz do projeto):
 *   ELEVENLABS_API_KEY
 *   EL_NUMERO           DID iFalei em E.164, ex: +557933000000
 *   EL_SIP_USUARIO      mesmo valor de telefonia/.env
 *   EL_SIP_SENHA        mesmo valor de telefonia/.env
 *   EL_ENDERECO         IP da sua VPS, ex: 31.97.86.62
 *
 * Imprime o ELEVENLABS_PHONE_NUMBER_ID no final.
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
const NUMERO = process.env.EL_NUMERO;
const USUARIO = process.env.EL_SIP_USUARIO;
const SENHA = process.env.EL_SIP_SENHA;
const ENDERECO = process.env.EL_ENDERECO;

for (const [nome, v] of Object.entries({
  ELEVENLABS_API_KEY: KEY,
  EL_NUMERO: NUMERO,
  EL_SIP_USUARIO: USUARIO,
  EL_SIP_SENHA: SENHA,
  EL_ENDERECO: ENDERECO,
})) {
  if (!v) {
    console.error(`Falta ${nome} no .env`);
    process.exit(1);
  }
}
if (!NUMERO.startsWith('+')) {
  console.error('EL_NUMERO precisa estar em E.164, comecando com +');
  process.exit(1);
}

const corpo = {
  provider: 'sip_trunk',
  phone_number: NUMERO,
  label: 'iFalei via Asterisk (Smart Center Aracaju)',

  // Para onde a ElevenLabs manda o INVITE nas chamadas de saida.
  outbound_trunk: {
    address: ENDERECO,
    transport: 'tcp',
    media_encryption: 'disabled',
    credentials: { username: USUARIO, password: SENHA },
  },

  // Chamadas entrantes: nao usamos por enquanto, mas o trunk precisa existir.
  inbound_trunk: {
    allowed_addresses: [`${ENDERECO}/32`],
    credentials: { username: USUARIO, password: SENHA },
  },
};

const r = await fetch('https://api.elevenlabs.io/v1/convai/phone-numbers', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'xi-api-key': KEY },
  body: JSON.stringify(corpo),
});

const txt = await r.text();

if (!r.ok) {
  console.error(`\nFalhou: ${r.status}\n`);
  console.error(txt);
  console.error(
    `\nSe for 422, o corpo do erro diz qual campo a API espera —\n` +
      `os nomes de inbound_trunk/outbound_trunk mudaram de versao para versao.\n` +
      `Se for 401, a chave esta errada. Se for 403, e limitacao do plano.`,
  );
  process.exit(1);
}

const dados = JSON.parse(txt);
const id = dados.phone_number_id ?? dados.id;

console.log('\n=== NUMERO IMPORTADO ===\n');
console.log(`ELEVENLABS_PHONE_NUMBER_ID=${id}`);
console.log('\nCole no .env e nas variaveis do Coolify.');
console.log('\nPara conferir a lista completa:');
console.log(
  `  curl -s https://api.elevenlabs.io/v1/convai/phone-numbers -H "xi-api-key: $ELEVENLABS_API_KEY"`,
);
