# Comece aqui

Quatro comandos. Sem banco de dados, sem telefonia, sem cadastro em lugar nenhum.
Os dados ficam num arquivo JSON local (`dados/store.json`).

## 1. Confira o Node

    node -v

Precisa ser 20 ou maior.

## 2. Instale e configure

    cd orquestrador-voz
    npm install
    copy .env.local.example .env      # no Windows (cmd)
    cp .env.local.example .env        # no macOS/Linux/PowerShell

Não precisa editar o `.env`. Ele já vem pronto:
- `SUPABASE_URL` vazio faz o projeto usar o store local em `dados/store.json`
- `DRY_RUN=true` ignora a janela de horário comercial e imprime o SMS no
  terminal em vez de enviar

## 3. Suba os três processos

Três terminais, um comando em cada:

    npm run mock:voz        # provedor de voz falso, porta 4000
    npm run mock:triagem    # Triagem AI falso, porta 4001
    npm run dev             # o orquestrador, porta 3001

No terceiro devem aparecer estas tres linhas:

    [env] .env carregado
    [env] DRY_RUN=true
    [dados] store local em ./dados/store.json

Se aparecer `[env] .env NAO ENCONTRADO`, o arquivo nao foi criado. No Windows (cmd)
use `copy .env.local.example .env` — o comando `cp` nao existe no cmd.

## 4. Rode a simulação

Quarto terminal:

    npm run simular
    npm run ver

## O que você deve ver

**No terminal do mock:voz** — o prompt completo que iria para o agente, já com o
nome, o endereço e o modelo da OS interpolados. Leia em voz alta: é o teste mais
importante do projeto.

**No terminal do dev** — um `tool_call` por etapa e a linha do SMS simulado:

    [DRY_RUN] sms -> 79999998888: Smart Center Aracaju - OS 4181234567. Envie a
    nota fiscal e a foto da etiqueta do produto por aqui: http://localhost:3000/envio/...

**No `npm run ver`** — a triagem consolidada:

    status              concluida
    etapa               doc_enviado
    cadastro_nome       Maria da Silva Santos
    cadastro_corrigido  true
    sintoma_confirmado  Unidade interna liga mas nao resfria; codigo E1 no painel
    codigo_erro         E1
    doc_canal           sms

Para zerar e rodar de novo: `rm -rf dados`.

## Erros comuns

**`chamada nao foi criada`** — o `mock:voz` não está no ar, ou a porta 4000 está ocupada.

**`401 assinatura inválida`** — você rodou `node mock/simular-chamada.mjs` direto.
Use `npm run simular`, que passa o `--env-file`.

**`202 {"status":"agendada_proxima_janela"}`** — o `DRY_RUN` nao chegou no processo.
Confira as linhas `[env]` no terminal do `dev`. Contorno imediato, no cmd:
`set DRY_RUN=true && npm run dev`.

**`Cannot find module`** — faltou o `npm install`.

## Quando quiser banco de verdade

Crie o projeto no Supabase, rode `src/db/schema.sql` no SQL Editor e preencha
`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no `.env`. Nenhuma linha de código muda —
o `src/services/supabase.ts` troca de implementação sozinho.

O store local existe para você validar o roteiro da conversa rápido. Não use em
produção: ele não tem concorrência, índice nem retenção.

## Depois que funcionar

1. Aponte `TRIAGEM_API_URL` para o seu Next.js real e implemente os dois endpoints
   que o `src/services/triagem.ts` espera: `/api/codigos-erro/lookup` e
   `/api/triagem/analisar`.
2. Só então contrate o provedor de voz e troque o `VOICE_API_URL`. Para os webhooks
   chegarem na sua máquina, exponha com `ngrok http 3001` e ponha a URL no `PUBLIC_URL`.
3. Antes disso, ligue para o suporte da iFalei e pergunte se o tronco SIP pode
   terminar em IP de terceiro. Se não puder, o caminho muda para Asterisk próprio e
   vale reavaliar antes de gastar com o provedor de voz.
