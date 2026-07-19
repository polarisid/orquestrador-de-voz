# Asterisk local com tronco iFalei

Objetivo desta pasta: provar que o seu ramal iFalei consegue originar chamadas
a partir do notebook. Nada de IA ainda — primeiro o cano, depois a água.

## 1. Antes de tudo

Troque a senha do ramal no painel PABX. Depois:

    copy .env.example .env

Preencha `IFALEI_SENHA`, `ARI_SENHA` e `NUMERO_TESTE` (seu celular).

## 2. Suba

    docker compose up -d
    docker compose logs -f

## 3. Confirme o registro

    docker exec -it asterisk-triagem asterisk -rx "pjsip show registrations"

Você quer ver `Registered`. Se aparecer `Rejected` ou `Auth`, a senha está errada
ou o servidor SIP é outro — confira no e-mail de ativação se o seu é
`sip.ifalei.com.br` ou `sip20.pabxsip.com.br`.

## 4. Primeira ligação de verdade

    docker exec -it asterisk-triagem asterisk -rx \
      "channel originate PJSIP/5579999998888@ifalei application Playback demo-congrats"

Troque pelo seu número. Seu celular deve tocar e reproduzir uma mensagem em inglês.
Se isso funcionou, o tronco está operacional e o resto é software.

## 5. Diagnóstico quando não funciona

    docker exec -it asterisk-triagem asterisk -rx "pjsip set logger on"
    docker compose logs -f

Erros mais comuns:

**Registra mas a ligação cai na hora** — o plano do ramal não libera saída para
celular, ou falta o prefixo de discagem. Confira no painel.

**Registra e chama, mas sem áudio (áudio unidirecional)** — NAT. Descomente
`external_media_address` e `local_net` no `pjsip.conf` com seu IP público e sua
faixa de rede local. É o problema número um de SIP em rede doméstica.

**`403 Forbidden`** — senha errada, ou o ramal já está registrado no softphone.
Feche o softphone: um ramal aceita um registro por vez.

## 6. Depois que o teste 1 passar

Aí sim entra o áudio para o agente, via ExternalMedia do ARI: o Asterisk abre um
socket RTP e manda o áudio bruto para o seu serviço, que faz STT, chama o Triagem
AI e devolve o TTS. É o próximo passo — e é o mais trabalhoso do projeto inteiro.

## Comandos de diagnóstico

    # o que importa: o tronco registrou?
    docker exec -it asterisk-triagem asterisk -rx "pjsip show registrations"

    # o endpoint está alcançável?
    docker exec -it asterisk-triagem asterisk -rx "pjsip show endpoints"

    # ligação de teste
    docker exec -it asterisk-triagem asterisk -rx \
      "channel originate PJSIP/5579SEUNUMERO@ifalei application Playback demo-congrats"

    # log SIP da tentativa, só as últimas linhas
    docker exec -it asterisk-triagem asterisk -rx "pjsip set logger on"
    docker logs --tail 100 -f asterisk-triagem
