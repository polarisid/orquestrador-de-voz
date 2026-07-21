# ElevenLabs Agents + iFalei

Topologia:

    Painel  ──POST /calls──►  Orquestrador
                                  │
                                  ├─ POST /v1/convai/sip-trunk/outbound-call
                                  ▼
                             ElevenLabs Agents
                                  │ INVITE (digest auth)
                                  ▼
                          SEU Asterisk (VPS)
                                  │ Dial pelo tronco já registrado
                                  ▼
                               iFalei ──► celular do cliente

    Durante a conversa:
    ElevenLabs ──POST /webhooks/el/<tool>──► Orquestrador ──► Triagem AI
    Ao encerrar:
    ElevenLabs ──POST /webhooks/elevenlabs──► Orquestrador

Por que o Asterisk no meio: a ElevenLabs manda INVITE de um IP dela, sem
registro. PABX brasileiro costuma recusar isso. Com o Asterisk, ela autentica
contra o SEU servidor e o tronco iFalei — que já está `Registered` e disca —
continua funcionando como está.

---

## 1. Asterisk: aceitar a ElevenLabs

No servidor:

    cd /opt/triagem && git pull
    cd telefonia && nano .env

Adicione:

    EL_SIP_USUARIO=elevenlabs
    EL_SIP_SENHA=<invente uma senha longa e aleatória>
    CALLER_ID_SAIDA=<seu DID iFalei, só dígitos>

Regenere e reinicie:

    bash gerar-config.sh
    docker restart asterisk-triagem
    docker exec -it asterisk-triagem asterisk -rx "pjsip show endpoints"

Devem aparecer `ifalei` e `elevenlabs`.

**Firewall — leia com atenção.** Não existe IP da ElevenLabs para liberar. A
documentação deles diz que o SIP vem de servidores distribuídos com IPs
variáveis, e que o RTP usa IPs dinâmicos. Bloco de IP fixo só em conta
Enterprise.

A saída é separar as duas pernas:

| Perna | Porta | Quem alcança |
|---|---|---|
| iFalei | 5060/UDP | só o IP da iFalei |
| ElevenLabs | 5062/TCP | internet (autenticação digest) |
| RTP | 10000-10200/UDP | internet |

    ufw allow 5062/tcp
    ufw allow 10000:10200/udp

Por que isso é seguro o bastante: os scanners SIP varrem 5060/UDP, não 5062/TCP.
O endpoint `elevenlabs` exige digest com a senha que você criou, e não existe
endpoint anônimo. O RTP aberto não é vetor de fraude — sem sinalização válida
não há chamada. E o fail2ban continua ativo.

Ainda assim, ative no painel da iFalei o bloqueio de destinos internacionais e
o limite de gasto. É a rede de segurança que importa se algo passar.

## 2. ElevenLabs: importar o número SIP

Fica em **Agents > Phone Numbers** (não dentro do agente):
https://elevenlabs.io/app/agents/phone-numbers

Se o botão de SIP não aparecer, é limitação de plano — número de telefone e SIP
trunking não vêm no gratuito.

### Pelo painel

| Campo | Valor |
|---|---|
| Address | `31.97.86.62` (o IP da sua VPS, sem `sip:`) |
| Transport | **TCP** |
| Port | 5062 |
| Media Encryption | Disabled (ou Allowed) |
| Authentication | Digest |
| Username | o `EL_SIP_USUARIO` |
| Password | o `EL_SIP_SENHA` |
| Phone number | o seu DID iFalei em E.164, ex. `+557933000000` |

Copie o **id do número** que aparece depois de salvar — é o
`ELEVENLABS_PHONE_NUMBER_ID`.

### Ou pela API

Preencha `EL_NUMERO`, `EL_ENDERECO`, `EL_SIP_USUARIO` e `EL_SIP_SENHA` no `.env`
da raiz e rode:

    npm run importar-numero

Imprime o `ELEVENLABS_PHONE_NUMBER_ID` direto. Se der 422, o corpo do erro diz
qual campo a API espera — o formato de `inbound_trunk`/`outbound_trunk` mudou
entre versões da API.

Para conferir o que já existe na conta:

    curl -s https://api.elevenlabs.io/v1/convai/phone-numbers \
      -H "xi-api-key: SUA_CHAVE"

## 3. Criar o agente e as tools

Local, com o `.env` preenchido (`ELEVENLABS_API_KEY`, `PUBLIC_URL` público,
`WEBHOOK_SECRET`):

    npm run criar-agente

O script cria as 6 webhook tools apontando para o seu `PUBLIC_URL` e o agente
com o roteiro de 5 etapas. Ao final imprime o `ELEVENLABS_AGENT_ID`.

Escolha antes uma voz pt-BR no painel e ponha o id em `ELEVENLABS_VOICE_ID` —
sem isso ele usa a voz padrão, que soa estrangeira.

## 4. Variáveis no Coolify

    ELEVENLABS_API_KEY=...
    ELEVENLABS_AGENT_ID=...
    ELEVENLABS_PHONE_NUMBER_ID=...
    ELEVENLABS_VOICE_ID=...

E **apague** `ELEVENLABS_API_URL` se existir — ela só serve para apontar ao mock.

## 5. Webhook pós-chamada

Painel da ElevenLabs > Workspace > Webhooks. Aponte para:

    https://<seu-dominio>/webhooks/elevenlabs

Evento: `post_call_transcription`. É o que preenche transcrição, duração e
resumo no painel.

## 6. Primeira ligação real

Ligue para o seu próprio celular pelo painel. O que observar, em ordem:

1. **O telefone toca** — a cadeia ElevenLabs → Asterisk → iFalei fechou
2. **A voz soa natural em pt-BR** — se soar estrangeira, é o `voice_id`
3. **Latência entre você falar e ele responder** — acima de 1,5s a conversa
   fica constrangedora
4. **As etapas acendem no painel** — as tools estão chegando
5. **O resumo aparece no cartão ao final** — o webhook está configurado

---

## Diferenças em relação a um provedor genérico

O agente é criado **uma vez**. Cada chamada só manda variáveis dinâmicas
(`{{os_numero}}`, `{{cliente_nome}}`...). Isso é melhor: o roteiro fica
versionado num lugar só.

A aba Roteiro do painel continua funcionando via override de prompt por
conversa — o script já habilita isso em `platform_settings.overrides`.

`transferir_humano` e `encerrar_triagem` só registram no banco. Quem executa é
o agente: o encerramento é a tool nativa `end_call` dele, e a transferência
precisa de uma **transfer rule** configurada no agente apontando para o ramal.
Configure no painel antes de usar em produção.

## Custo

Cobram por minuto de conversa, e a iFalei cobra o minuto de terminação. Some os
dois e multiplique pelo seu volume mensal de OS antes de escalar. Se não fechar,
o caminho alternativo é gravação + transcrição assíncrona, sem conversa em tempo
real.


---

## Depois que a primeira ligação funcionar

### O agente falou em inglês

O campo `language` sozinho não segura. Rode:

    npm run atualizar-agente

Ele faz PATCH no agente existente com `language: pt`, `asr.language: pt`, a voz
do `ELEVENLABS_VOICE_ID` e uma ordem explícita no topo do prompt mandando falar
sempre em português. A próxima ligação já usa a versão nova — não precisa
redeploy nem recriar tools.

Se continuar em inglês depois disso, o problema é a voz: vozes treinadas em
inglês puxam o modelo para o inglês. Troque por uma pt-BR de verdade.

### Transcrição e áudio no painel

Clique em qualquer cartão para expandir. Aparecem o resumo, o player da gravação
e o diálogo com carimbo de tempo — agente à esquerda, cliente à direita.

Os dados vêm da API sob demanda (`GET /v1/convai/conversations/:id`), não do
webhook. Isso significa que funciona mesmo sem o webhook pós-chamada
configurado, e continua funcionando se um webhook se perder. A primeira leitura
grava no banco; as seguintes saem do cache.

O áudio é servido por `/calls/:id/audio`, que faz proxy da ElevenLabs — a chave
de API nunca chega ao navegador.

Se o player vier vazio logo após a ligação, espere alguns segundos: a gravação
leva um tempo para ficar disponível do lado deles.


### Login do painel

O painel usa Supabase Auth. Sem `SUPABASE_URL` e `SUPABASE_ANON_KEY`
configurados a autenticação fica **desligada** — o que é conveniente para rodar
local, mas nunca deixe assim num domínio público.

Para ligar:

1. No projeto Supabase, em Authentication > Providers, deixe Email habilitado e
   **desligue** "Enable sign ups" — você não quer que qualquer um crie conta.
2. Em Authentication > Users, crie manualmente os usuários da equipe.
3. No Coolify, preencha:

       SUPABASE_URL=https://xxxx.supabase.co
       SUPABASE_ANON_KEY=eyJ...

   A chave anon é pública por design; ela vai para o navegador. A que nunca
   pode vazar é a `service_role`.

4. Deploy. O painel passa a redirecionar para `/login.html`.

Os webhooks continuam autenticando por `x-signature`, não por login — a
ElevenLabs não faz login.

### Garantia muda a conversa

O campo **Garantia** no formulário tem três valores e cada um leva o agente por
um caminho diferente na etapa 4:

| Valor | O que o agente faz |
|---|---|
| Em garantia | Pede nota fiscal + etiqueta. Não promete cobertura. |
| Fora de garantia | Avisa do custo de visita e do orçamento. Pede só a etiqueta. Pergunta se quer seguir mesmo assim. |
| A confirmar | Explica que depende da data de compra. Pede os dois documentos e avisa da possibilidade de custo. |

Nenhum dos três fala valores — quem informa preço é o comercial. Isso é
deliberado: valor dito por telefone por um agente vira expectativa que você
não controla.


### Desligar a chamada pelo painel

Vai pelo Asterisk, não pela ElevenLabs — derrubar o canal encerra a ligação de
verdade, independente do que o agente esteja fazendo.

No `telefonia/.env` você já tem `ARI_SENHA`. Repita a mesma no Coolify:

    ASTERISK_ARI_URL=http://172.17.0.1:8088/ari
    ARI_USUARIO=triagem
    ARI_SENHA=<a mesma de telefonia/.env>

`172.17.0.1` é o gateway da bridge do Docker: o orquestrador roda em container
e o Asterisk em rede host, então `127.0.0.1` não alcança. Se o endereço for
outro na sua VPS, confira com `ip addr show docker0`.

Libere a porta apenas para a bridge, nunca para fora:

    ufw allow from 172.17.0.0/16 to any port 8088 proto tcp

Sem essas variáveis o botão aparece mas responde com uma mensagem explicando o
que falta — não falha em silêncio.

### O cartão não fica mais preso em "na linha"

Um laço de reconciliação roda a cada 12 segundos, pergunta à ElevenLabs o estado
das chamadas ativas e finaliza as que já acabaram. É rede de segurança para o
caso de o webhook pós-chamada não estar configurado ou se perder.

Chamada que passa de 20 minutos sem desfecho é encerrada como `sem_contato` —
sem isso, uma conversa que nunca completa ficaria sendo consultada para sempre.


### Escutar a ligação ao vivo

Não existe endpoint da ElevenLabs para isso. O áudio passa pelo seu Asterisk, e
é lá que bifurcamos:

    canal da ligação
         ├─ snoop (spy=both) ─┐
         │                    ├─ bridge ─► externalMedia ─RTP─► orquestrador
         └─ segue normal      │                                      │
                                                          WebSocket ─► navegador

O snoop é somente leitura. Nem o cliente nem o agente ouvem o supervisor.

**Pré-requisitos** (os mesmos do botão de desligar):

    ASTERISK_ARI_URL=http://172.17.0.1:8088/ari
    ARI_USUARIO=triagem
    ARI_SENHA=<a mesma de telefonia/.env>

O RTP vai do Asterisk (rede host) para o container do orquestrador numa porta
alta sorteada a cada sessão. O IP é detectado sozinho; se sua rede for atípica,
force com `ESCUTA_HOST`.

**Como usar:** abra uma chamada em andamento e clique em **Escutar**. As barras
ao lado do botão mostram o nível de áudio — se elas se mexem, está chegando som.

**Se não funcionar**, a mensagem ao lado do botão diz o motivo. Os dois mais
comuns são `falta configurar ARI_SENHA` e `não há canal ativo`.

Para conferir do lado do Asterisk durante uma escuta:

    docker exec -it asterisk-triagem asterisk -rx "core show channels"

Devem aparecer o canal da ligação, um `Snoop/...` e um `UnicastRTP/...`.

#### Plano B: escutar por softphone

Mais simples e sem navegador. Registre um softphone (MicroSIP, Zoiper) em
`31.97.86.62`, TCP 5060, usuário `escuta`, senha do `ESCUTA_SENHA`. Disque **90**
e você entra em modo espião. Tecla `#` pula para a próxima chamada ativa.

Funciona do celular também, o que é útil para supervisão fora da mesa.


---

## Fluxos de ligação

O sistema deixou de ter um roteiro único. Cada tipo de ligação é um **fluxo**,
definido em `src/agent/fluxos.ts`, e o painel se adapta a ele: o formulário, o
trilho de etapas e o roteiro mudam junto.

| Fluxo | Para quê |
|---|---|
| `triagem` | Confirma cadastro, investiga o sintoma, pede documentação |
| `retirada` | Avisa que o reparo terminou e combina quem retira e quando |

Escolha no seletor **Tipo de ligação**, no topo do formulário.

### Criar um fluxo novo

Adicione um objeto em `src/agent/fluxos.ts` com `id`, `nome`, `etapas`, `campos`
e `montarPrompt`. Nada mais precisa mudar — o painel lê de `/fluxos` e monta
tudo sozinho.

### Editar o roteiro sem tocar em código

Na aba **Roteiro**, escolha o fluxo, edite e clique em **Salvar como padrão**.
A partir dali todas as ligações daquele tipo usam o texto salvo.

Use `{{campo}}` para os dados da OS — os nomes são os mesmos dos campos do
formulário: `{{os_numero}}`, `{{cliente_nome}}`, `{{pagamento}}`, e assim por
diante.

**Voltar ao original** recarrega o roteiro do código sem apagar o salvo; para
descartar de vez, limpe o campo e salve vazio.

Se você editar e **não** salvar, a alteração vale só para a próxima ligação que
disparar — útil para testar uma frase antes de firmar.

### O fluxo de retirada em resumo

1. Abertura com aviso de gravação
2. A boa notícia: produto pronto, o que foi feito, e a situação de pagamento
3. Quem retira e quando, com aviso do prazo de guarda
4. O que levar: documento com foto e número da OS, enviado por WhatsApp ou SMS
5. Encerramento

O agente **nunca informa valores**. Se o cliente insistir, transfere para
atendente. É deliberado: valor dito por telefone vira expectativa que você não
controla.

Novas tools: `confirmar_aviso_retirada` e `registrar_retirada`. Rode
`npm run criar-agente` numa conta limpa, ou crie essas duas manualmente e
adicione ao agente existente.


---

## Banco de dados: schema isolado

O projeto Supabase pode ter outras tabelas em uso. Nada da camada de voz encosta
nelas: tudo vive no schema **`voz`**, e o `schema.sql` só faz
`create ... if not exists` — nenhum `drop`, `truncate` ou `alter` em objeto que
já exista.

Passos:

1. Cole `src/db/schema.sql` no SQL Editor e execute
2. **Settings > API > Exposed schemas**: adicione `voz` à lista
3. No Coolify:

       SUPABASE_URL=https://xxxx.supabase.co
       SUPABASE_SERVICE_ROLE_KEY=...
       SUPABASE_ANON_KEY=...
       SUPABASE_SCHEMA=voz

O passo 2 é o que mais esquece: sem expor o schema, o PostgREST responde
"relation does not exist" mesmo com as tabelas criadas.

Se preferir tudo em `public`, é só `SUPABASE_SCHEMA=public` e trocar `voz.` por
nada no SQL. Mas o isolamento vale: quando o projeto crescer, você olha o schema
e sabe na hora o que é de quê.
