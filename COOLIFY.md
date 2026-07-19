# Deploy no Coolify

Duas peças, dois métodos. Não misture.

| O quê | Onde | Por quê |
|---|---|---|
| Orquestrador (Node) | Coolify | HTTP puro — domínio e TLS de graça |
| Asterisk | SSH, fora do Coolify | precisa de rede host e UDP cru |

O Coolify roteia por Traefik, que faz proxy de HTTP. SIP é UDP na 5060 e o áudio
são centenas de portas UDP altas. Isso não passa por proxy reverso.

---

# Parte 1 — Orquestrador no Coolify

## 1. Suba para o Git

No repositório PRIVADO (o `.gitignore` já protege `.env` e `dados/`):

    git init
    git add .
    git commit -m "orquestrador de triagem por voz"
    git branch -M main
    git remote add origin git@github.com:polarisid/orquestrador-voz.git
    git push -u origin main

Confira antes do push que `git status` NÃO lista `.env` nem `telefonia/.env`.
Se listar, pare — tem senha de ramal ali dentro.

## 2. Conecte o GitHub ao Coolify

Se ainda não conectou: **Sources > + Add > GitHub App**, e autorize.
Para repositório privado é obrigatório — Public Repository não enxerga.

## 3. Crie a aplicação

**Projects > seu projeto > + New > Application**

- Source: o repositório
- Branch: `main`
- Build Pack: **Dockerfile** (o `Dockerfile` já está na raiz)
- Ports Exposes: `3001`

Use Dockerfile, não Nixpacks. O build fica previsível e o healthcheck vem junto.

## 4. Variáveis de ambiente

Em **Environment Variables**, cole tudo de uma vez pelo botão *Developer view*:

    NODE_ENV=production
    PORT=3001
    PUBLIC_URL=https://voz.SEUDOMINIO.com.br
    WEBHOOK_SECRET=<gere um valor aleatorio longo>

    VOICE_API_URL=
    VOICE_API_KEY=
    SIP_TRUNK_ID=
    CALLER_ID=
    TTS_VOICE=
    RAMAL_ATENDIMENTO=102

    TRIAGEM_API_URL=https://triagem.SEUDOMINIO.com.br
    TRIAGEM_API_KEY=

    PORTAL_URL=https://triagem.SEUDOMINIO.com.br

    SUPABASE_URL=
    SUPABASE_SERVICE_ROLE_KEY=

    IFALEI_API_URL=https://painelv2.ifalei.com.br
    IFALEI_TOKEN=
    IFALEI_USUARIO_ID_ORIGEM=

Marque como **Build Variable** apenas se precisar no build — nenhuma destas precisa.

Não coloque `DRY_RUN=true` aqui. Em produção você quer a janela de horário
comercial funcionando, que é o que impede ligação para cliente às 23h.

## 5. Domínio

Em **Domains**: `https://voz.SEUDOMINIO.com.br`

Antes, no seu DNS, crie um registro A apontando o subdomínio para o IP da VPS.
O Coolify emite o certificado sozinho depois que o DNS propagar.

## 6. Healthcheck

Em **Health Checks**, ative e use path `/health`. O Coolify passa a segurar o
deploy até o serviço responder — evita derrubar a versão boa por uma quebrada.

## 7. Deploy

Clique em **Deploy** e acompanhe os logs. Você deve ver:

    [env] sem .env; usando variáveis do ambiente
    [env] DRY_RUN=(vazio)
    [dados] store local em ./dados/store.json
    Server listening at http://0.0.0.0:3001

Confira: `https://voz.SEUDOMINIO.com.br/health` retorna `{"ok":true}`.

## 8. Persistência (só se ainda estiver sem Supabase)

O store local grava em `/app/dados`, que some a cada deploy. Se quiser manter os
dados entre deploys, em **Storages** adicione um volume em `/app/dados`.

Isso é paliativo. Assim que a triagem sair do teste, plugue o Supabase: preencha
`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` e rode o `src/db/schema.sql`.
Nenhuma linha de código muda.

---

# Parte 2 — Asterisk por SSH

    scp -r telefonia root@SEU_IP:/opt/asterisk-triagem
    ssh root@SEU_IP
    cd /opt/asterisk-triagem
    cp .env.example .env && nano .env      # senha NOVA do ramal
    bash provisionar-vps.sh

O script resolve o IP da iFalei, fecha o firewall liberando só esse IP, instala o
fail2ban e sobe o container com `network_mode: host`.

Depois disso o Asterisk fala com o orquestrador por `http://127.0.0.1:3001` —
rede interna da própria VPS, sem sair para a internet.

## Cuidado com o firewall do Coolify

O `provisionar-vps.sh` roda `ufw --force enable`. Se o UFW estiver desligado hoje
(comum em VPS com Coolify), habilitá-lo pode cortar o acesso ao painel. O script
já libera a 22, mas o Coolify usa outras:

    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw allow 8000/tcp     # painel do Coolify
    ufw allow 6001/tcp     # realtime do Coolify

Rode essas ANTES do script, ou tire o `ufw --force enable` dele e configure o
firewall pelo painel da Hostinger.

---

# Checklist

- [ ] `git status` não lista nenhum `.env` antes do push
- [ ] `/health` responde no domínio público
- [ ] Logs mostram `usando variáveis do ambiente`
- [ ] `WEBHOOK_SECRET` é aleatório, não `troque-isto`
- [ ] `pjsip show registrations` mostra `Registered`
- [ ] `ufw status` NÃO mostra 5060 aberta para `Anywhere`
- [ ] Painel do Coolify ainda acessível depois do firewall
- [ ] Bloqueio internacional e limite de gasto ativos no painel da iFalei
