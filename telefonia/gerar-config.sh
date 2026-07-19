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
export EL_SIP_USUARIO EL_SIP_SENHA
export IFALEI_SERVIDOR="${IFALEI_SERVIDOR:-sip.ifalei.com.br}"

command -v envsubst >/dev/null || apt-get install -y -qq gettext-base

VARS='${IFALEI_USUARIO} ${IFALEI_SENHA} ${IFALEI_SERVIDOR} ${ARI_SENHA} ${EL_SIP_USUARIO} ${EL_SIP_SENHA}'

for t in conf/*.template; do
  destino="${t%.template}"
  envsubst "$VARS" < "$t" > "$destino"
  chmod 600 "$destino"
  echo "gerado: $destino"
done

echo
echo "--- conferencia ---"
grep -E "^username=|^password=|^client_uri=|^server_uri=" conf/pjsip.conf
