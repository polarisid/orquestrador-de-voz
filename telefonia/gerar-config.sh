#!/usr/bin/env bash
# Gera os .conf a partir dos .template, substituindo as variaveis do .env.
# O Asterisk NAO expande variaveis de ambiente sozinho — por isso este passo.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "!! crie o .env a partir de .env.example"; exit 1; }
set -a; . ./.env; set +a

: "${IFALEI_USUARIO:?defina IFALEI_USUARIO no .env}"
: "${IFALEI_SENHA:?defina IFALEI_SENHA no .env}"
: "${ARI_SENHA:?defina ARI_SENHA no .env}"
: "${EL_SIP_USUARIO:=elevenlabs}"
: "${EL_SIP_SENHA:?defina EL_SIP_SENHA no .env}"
: "${EL_FROM_USER:?defina EL_FROM_USER no .env — o DID como a ElevenLabs manda no From, com o +}"
: "${ESCUTA_SENHA:=trocar-esta-senha}"
: "${CALLER_ID_SAIDA:?defina CALLER_ID_SAIDA no .env — o numero que aparece no visor do cliente}"
export ESCUTA_SENHA CALLER_ID_SAIDA
export EL_SIP_USUARIO EL_SIP_SENHA EL_FROM_USER
export IFALEI_SERVIDOR="${IFALEI_SERVIDOR:-sip.ifalei.com.br}"

command -v envsubst >/dev/null || apt-get install -y -qq gettext-base

VARS='${IFALEI_USUARIO} ${IFALEI_SENHA} ${IFALEI_SERVIDOR} ${ARI_SENHA} ${EL_SIP_USUARIO} ${EL_SIP_SENHA} ${EL_FROM_USER} ${ESCUTA_SENHA} ${CALLER_ID_SAIDA}'

for t in conf/*.template; do
  destino="${t%.template}"
  envsubst "$VARS" < "$t" > "$destino"
  chmod 600 "$destino"
  echo "gerado: $destino"
done

echo
echo "--- conferencia ---"
grep -E "^username=|^password=|^client_uri=|^server_uri=" conf/pjsip.conf
echo
echo "Endpoints gerados:"
grep -E "^\[" conf/pjsip.conf | sort -u
echo
echo "Caller ID de saida:"
grep -m1 "CALLERID(num)" conf/extensions.conf
