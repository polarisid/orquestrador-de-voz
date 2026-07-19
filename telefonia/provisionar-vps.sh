#!/usr/bin/env bash
# Provisiona o Asterisk na VPS, FORA do Coolify.
# Uso:  bash provisionar-vps.sh
# Rode como root, por SSH, na VPS da Hostinger.
set -euo pipefail

echo "==> 1/5  Docker (o Coolify já instalou, isto é só conferência)"
docker --version || { curl -fsSL https://get.docker.com | sh; }

echo "==> 2/5  Descobrindo o IP do servidor SIP da iFalei"
IP_IFALEI=$(getent hosts sip.ifalei.com.br | awk '{print $1}' | head -1)
if [ -z "$IP_IFALEI" ]; then
  echo "!! Nao resolveu sip.ifalei.com.br. Confira no e-mail de ativacao se o seu"
  echo "   servidor e sip20.pabxsip.com.br e ajuste este script."
  exit 1
fi
echo "    iFalei = $IP_IFALEI"

echo "==> 3/5  Firewall"
# Regra de ouro: 5060 aberta para o mundo = varredura de bots em minutos
# e fraude de tarifacao. Libere SOMENTE o IP da iFalei.
ufw allow 22/tcp
ufw allow from "$IP_IFALEI" to any port 5060 proto udp
ufw allow from "$IP_IFALEI" to any port 10000:10200 proto udp
ufw --force enable
ufw status numbered

echo "==> 4/5  fail2ban"
apt-get update -qq && apt-get install -y -qq fail2ban
cat > /etc/fail2ban/jail.d/asterisk.conf << 'JAIL'
[asterisk]
enabled  = true
port     = 5060
protocol = udp
filter   = asterisk
logpath  = /var/log/asterisk/messages
maxretry = 3
bantime  = 86400
JAIL
systemctl restart fail2ban

echo "==> 5/5  Gerando config e subindo o Asterisk"
cd "$(dirname "$0")"
[ -f .env ] || { echo "!! crie o .env a partir de .env.example antes"; exit 1; }
bash gerar-config.sh
docker compose -f docker-compose.vps.yml up -d

sleep 8
docker exec asterisk-triagem asterisk -rx "pjsip show registrations" || true

echo
echo "Pronto. Se apareceu 'Registered' acima, o tronco esta no ar."
echo "Teste a ligacao:"
echo "  docker exec -it asterisk-triagem asterisk -rx \"channel originate PJSIP/SEUNUMERO@ifalei application Playback demo-congrats\""
