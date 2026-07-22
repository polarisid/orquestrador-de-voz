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


---

# Suíte de voz

## Fluxos disponíveis

| Fluxo | Quando usar |
|---|---|
| Triagem técnica | OS aberta, antes de mandar técnico |
| Retirada de produto reparado | Reparo pronto, avisar e combinar retirada |
| Confirmação de visita | Véspera da visita agendada |
| Cobrança de documentação | OS parada esperando nota fiscal ou etiqueta |
| Pesquisa de satisfação | Atendimento concluído |

Cada um define os próprios campos, etapas e roteiro em `src/agent/fluxos.ts`.
Todos podem ser editados e salvos pelo painel, na aba Roteiro.

## Fila de discagem

Aba **Fila**. Cole uma planilha com cabeçalho — copiar do Excel e colar
funciona. O cabeçalho aceita tanto o rótulo do formulário ("Nome do cliente")
quanto o nome técnico do campo ("cliente_nome").

**Copiar modelo** preenche a caixa com o cabeçalho certo do fluxo escolhido.

Linhas inválidas são recusadas individualmente, com o motivo, e as boas entram
mesmo assim. Nada de rejeitar o lote inteiro por causa de um telefone errado.

Três limites governam o disparo:

| Limite | Padrão | Por quê |
|---|---|---|
| Janela | 8h-20h, seg-sáb | ninguém liga para cliente às 22h |
| Simultâneas | `MAX_CHAMADAS_SIMULTANEAS=1` | um ramal iFalei aguarda uma por vez; estourar gera recusas que parecem falha do agente |
| Tentativas | 3, com 90 min entre elas | insistir sem limite vira perseguição |

Quem não atendeu volta para a fila sozinho. Quem falou é marcado como concluída.

Se você contratar um tronco com vários canais, suba o
`MAX_CHAMADAS_SIMULTANEAS` — é a única mudança necessária para escalar.

## Números

Aba **Números**, últimos 30 dias. As métricas foram escolhidas por mudarem
decisão:

- **falaram com alguém** — se estiver baixo, o problema é horário ou caller ID,
  não o roteiro
- **cadastro errado na OS** — costuma ser o número que justifica o projeto
  sozinho: cada endereço errado evitado é uma visita perdida a menos
- **foram para humano** — acima de 25% o cartão fica âmbar; é sinal de que o
  roteiro está falhando em algum ponto, e a transcrição mostra onde
- **esperando revisão** — sua fila de trabalho

---

# O que ainda falta: receptivo

Hoje a suíte só liga. Receber ligação é o maior volume de uma assistência, e a
base já está pronta: o tronco inbound da ElevenLabs já aponta para o seu IP.

O que falta:

1. Um agente de receptivo na ElevenLabs, com roteiro próprio: identificar o
   cliente pelo telefone, consultar o status da OS, informar, e transferir para
   humano quando fugir do escopo
2. Uma tool `consultar_status_os` no orquestrador, batendo no seu sistema
3. Dialplan no Asterisk roteando o DID de entrada para a ElevenLabs em vez de
   para o ramal
4. Decidir o horário: fora do expediente o agente atende sozinho; no expediente,
   talvez só transborde

O item 4 é decisão de operação, não técnica — e é o que define se isso ajuda ou
atrapalha seu atendimento humano.


---

## O agente não desligava a ligação

Causa: a tool nativa **End Call** só vem habilitada por padrão em agentes
criados pelo painel. O nosso foi criado por API, então nasceu sem ela — o
agente terminava de falar e ficava na linha até o cliente desligar ou o
timeout estourar. Minuto pago por silêncio.

A correção tem três camadas:

**1. Habilitar a tool no agente.** Ela vai em
`conversation_config.agent.prompt.built_in_tools`, separada das webhook tools:

    built_in_tools: { end_call: {} }

Rode `npm run atualizar-agente` — o script já manda isso.

**2. Instruir no roteiro.** Ter a tool não basta; o modelo precisa saber quando
usar. Todos os fluxos agora terminam com a ordem explícita de encerrar depois da
despedida.

**3. Rede de segurança pelo Asterisk.** Depois que `encerrar_triagem` é chamada,
o orquestrador agenda a derrubada do canal em `SEGUNDOS_ATE_DESLIGAR` (12 por
padrão). Se o agente já encerrou, não há canal e nada acontece. Se ele esqueceu,
a linha cai mesmo assim.

Precisa do ARI configurado. Sem ele a camada 3 fica inerte e você depende só
das duas primeiras.

    SEGUNDOS_ATE_DESLIGAR=12

Zero desliga o recurso.

### Enquanto isso: transferir_humano tem o mesmo problema

`transferir_humano` hoje só registra no banco — o transbordo real precisa da
system tool `transfer_to_number` configurada no agente, apontando para o ramal
de atendimento. Sem ela, o cliente irritado pede atendente, o agente diz "vou
transferir", e nada acontece. É o pior desfecho possível.

Configure no painel da ElevenLabs, em Tools do agente, antes de usar em
produção.


---

## Transferir para um atendente

Duas peças precisam existir. Ter só uma faz o agente prometer transferência e
não entregar.

### 1. A ferramenta no agente

`transferir_humano` só grava no banco — quem transfere de verdade é a system
tool `transfer_to_number` da ElevenLabs. Configure o destino:

    NUMERO_TRANSBORDO=+557933000000

E rode `npm run atualizar-agente`. O script monta a regra com a condição de
quando transferir (cliente pediu, demonstrou irritação, perguntou valores, ou
duas falhas de entendimento).

Para um ramal específico, use SIP URI:

    NUMERO_TRANSBORDO=sip:1001@sip.ifalei.com.br

**Prefira o número.** Um DID deixa a central distribuir para quem estiver livre;
o ramal amarra o transbordo a uma pessoa, e quando ela sai de férias você
descobre pelo cliente.

### 2. O caminho no Asterisk

O dialplan agora reconhece ramal curto (3 a 5 dígitos) e manda direto para a
central, sem prefixo de DDD. Números completos seguem o caminho normal.

Se o ramal tocar e ninguém atender, o cliente ouve um aviso em vez de silêncio —
`vm-nobodyavail`, que é um som padrão do Asterisk.

    cd /opt/triagem && git pull
    cd telefonia && bash gerar-config.sh && docker restart asterisk-triagem

### O detalhe que vai te pegar

**Transferência consome um segundo canal.** Durante o transbordo existem duas
pernas ao mesmo tempo: a do cliente e a do atendente. Com `MAX_CHAMADAS_SIMULTANEAS=1`
e um único canal no ramal iFalei, a transferência pode simplesmente falhar por
falta de canal.

Se o transbordo for parte real da operação, isso deixa de ser opcional: você
precisa de tronco com pelo menos dois canais simultâneos. Vale perguntar o preço
à iFalei antes de prometer transferência ao cliente.

### Como testar

1. Dispare uma ligação para o seu próprio celular
2. Diga "quero falar com uma pessoa"
3. O agente deve avisar e transferir

No servidor, com o log SIP ligado, você vê um `REFER` saindo da ElevenLabs ou um
segundo `INVITE` para o destino. Se não vier nenhum dos dois, a system tool não
está configurada no agente.


### Transbordo configurável pelo painel

Botão **Ajustes**, no topo. O destino fica no banco, não em variável de
ambiente: trocar o ramal é decisão de operação, e operação não pode depender de
redeploy.

Aceita três formatos:

| Você digita | Vira |
|---|---|
| `1001` | `sip:1001@sip.ifalei.com.br` |
| `+557933000000` | número em E.164 |
| `sip:fila@pbx.exemplo` | usado como está |

Campo vazio desliga a transferência — o agente perde a system tool e para de
prometer o que não pode cumprir.

**Salvar e aplicar** grava aqui e faz o PATCH no agente da ElevenLabs na hora.
Se o PATCH falhar, o painel avisa em vez de fingir sucesso: salvo aqui mas não
aplicado lá é exatamente o estado que faz você achar que está transferindo
quando não está.

### Por que não dá para escolher o ramal por ligação

O destino da transferência vive na configuração do agente, não na chamada. Cada
destino diferente exigiria um agente diferente na ElevenLabs.

Se um dia isso for necessário — transbordo por linha de produto, por exemplo —
o caminho é apontar a transferência para um ramal-pivô no seu Asterisk e deixar
o dialplan decidir o destino final consultando a API do orquestrador com
`CURL()`. Funciona, mas só vale a complexidade se houver mais de um destino de
verdade.

---

## Roteiro salvo sumiu depois do deploy

Significa que os dados estão indo para `dados/store.json` **dentro do
container**, que é recriado a cada deploy.

Abra **Diagnóstico** no painel: a primeira seção diz onde os dados ficam e
testa uma gravação de ida e volta.

A pegadinha: o login usa `SUPABASE_ANON_KEY` e os dados usam
`SUPABASE_SERVICE_ROLE_KEY`. Faltando só a segunda, o login funciona
normalmente e você jura que o Supabase está configurado — mas os dados caem no
arquivo local, em silêncio.

No Coolify, as quatro precisam existir:

    SUPABASE_URL=https://xxxx.supabase.co
    SUPABASE_ANON_KEY=eyJ...          (login)
    SUPABASE_SERVICE_ROLE_KEY=eyJ...  (dados)
    SUPABASE_SCHEMA=voz

E no Supabase, **Settings > API > Exposed schemas** precisa listar `voz`. Sem
isso o PostgREST responde "relation does not exist" mesmo com as tabelas
criadas — o diagnóstico distingue esse caso do de variável ausente.

No log do boot dá para conferir sem abrir o painel:

    [dados] Supabase, schema "voz"              <- certo
    [dados] store local em ./dados/store.json   <- efemero


---

## Build falhando no `npx tsc` sem mensagem de erro

Se o log do Coolify corta em `RUN npx tsc` e nao mostra erro nenhum, o processo
nao falhou — foi **morto**. Quase sempre e memoria.

O Dockerfile anterior tinha dois estagios, e o BuildKit rodava os dois
`npm install` em paralelo. Numa VPS que ja roda n8n, dois Chatwoot, duas
Evolution API e varios Postgres, o pico derruba o build. O OOM killer nao deixa
mensagem: o processo simplesmente some.

Agora e estagio unico: instala uma vez, compila com teto de memoria explicito
(`--max-old-space-size=640`), e remove as dependencias de desenvolvimento
depois. Imagem final praticamente do mesmo tamanho.

### O bug que estava escondido junto

O estagio de runtime rodava `npm install --omit=optional`, e o
`@supabase/supabase-js` estava em `optionalDependencies`. Ou seja, o cliente
do Supabase nunca foi instalado em producao.

Nao dava sintoma porque `SUPABASE_URL` estava vazia e o import dinamico nunca
rodava. No momento em que voce preenchesse as chaves, o container quebraria no
boot — e o sintoma seria "parou de subir depois que configurei o banco", que
leva a investigar o lugar errado.

Corrigido: o pacote saiu de `optionalDependencies` para `dependencies`, e o
`npm prune --omit=dev` preserva ele.

### Se o build falhar de novo

No Coolify, ative **Show Debug Logs** antes do deploy — a saida do tsc aparece.
E confira a memoria da VPS durante o build:

    free -m
    docker stats --no-stream


---

## Ligar de novo com os mesmos dados

No detalhe de uma chamada que não foi atendida, aparece **Ligar de novo**. Ele
reusa o formulário inteiro — nada é redigitado — e dispara uma ligação nova.

Só aparece quando faz sentido tentar de novo: desligou, sem contato, não é o
titular, recusou a gravação, ou você encerrou manualmente. Não aparece em
concluída (já foi atendida) nem em transferida (já foi para humano).

A ligação nova é independente e entra na lista como qualquer outra. Ela guarda
o vínculo com a original no campo `tentativa_de`, e mostra "é uma nova
tentativa" no detalhe — assim o histórico não se perde.

Respeita a janela de atendimento: fora de 8h-20h, avisa em vez de discar.

### Diferença para o reagendamento da fila

A fila reagenda sozinha quem ela mesma discou, com espera entre tentativas. O
**Ligar de novo** é manual e imediato, para quando você olha uma chamada
específica e decide tentar na hora. Os dois coexistem sem conflito.


---

## Correio de voz e número indisponível

O agente caía em caixa postal, conversava com a gravação e ainda tentava
transferir — minuto pago por uma secretária eletrônica. Agora há duas camadas,
porque nenhuma pega todos os casos sozinha.

### Camada 1 — Asterisk, pela sinalização

Quando o número está morto (desligado, inexistente, fora de serviço), a
operadora sinaliza pela causa do hangup **antes de qualquer áudio**. O dialplan
detecta `CHANUNAVAIL` e `CONGESTION` no contexto `[sair]` e encerra na hora. É
o caminho mais rápido e barato: a ligação nem chega a ser atendida.

### Camada 2 — o agente, pela mensagem

Quando a operadora **atende** e toca a gravação ("grave sua mensagem após o
sinal"), para o Asterisk isso é uma chamada atendida como outra qualquer — ele
não tem como distinguir. Aí quem pega é o agente: instruído a reconhecer as
frases típicas de caixa postal logo no início e encerrar com status
`caixa_postal`, sem deixar recado nem tentar transferir.

A maioria dos casos no Brasil é este segundo — a operadora atende e toca o
recado. Por isso a instrução no roteiro é a defesa principal; o Asterisk cobre
o número morto.

### O que acontece depois

`caixa_postal` conta como sem contato nas métricas e é religável: quase sempre é
questão de horário, e a fila reagenda sozinha, com espera. No painel aparece o
selo "correio de voz".

Precisa de `npm run atualizar-agente` para o agente aprender a reconhecer, e do
dialplan atualizado (`gerar-config.sh` + restart) para a camada do Asterisk.

---

## Mudanças de julho: produtos, pagamento, latência e caixa postal

### Novas linhas de produto na retirada
Televisão, Monitor, Tablet, Celular, SmartWatch, Fone de ouvido — além das
linhas brancas que já existiam.

### Pagamento: "Orçamento recusado"
Para quando o cliente recusou o orçamento e o produto está disponível sem
reparo. O agente deixa claro que não houve conserto, e se perguntarem de
reembolso, responde que essa informação é passada na loja, na retirada — nunca
promete valor.

### Latência
Já usávamos os modelos mais rápidos (Flash v2.5 para voz, Gemini Flash para o
LLM). O que faltava e foi corrigido:
- `max_tokens: 250` e temperatura baixa — o maior fator de latência é o TAMANHO
  da resposta, não o modelo. Resposta curta vira áudio muito mais rápido.
- Roteiro reforça brevidade: uma ou duas frases por vez.
- `optimize_streaming_latency: 3` e turn detection ajustado.

Rode `npm run atualizar-agente` para aplicar.

### Alucinação de detalhe técnico (LED virava LCD)
O modelo "arredondava" termos parecidos. Duas defesas:
- Regra no topo do roteiro: dizer os dados EXATAMENTE como escritos, nunca
  trocar um termo por outro parecido nem "traduzir".
- A instrução antiga de "sem jargão técnico" na retirada era o que abria a
  porta — foi reescrita para citar o serviço literal.

### Caixa postal onde o agente começava a falar com a gravação
Causa: a primeira fala do agente era automática ao conectar, então ele
despejava a apresentação por cima do "grave sua mensagem".

Correção: a primeira fala agora é VAZIA. O agente espera a outra ponta falar.
Se for um "alô" de pessoa, ele se apresenta (o roteiro manda). Se for uma
gravação, ele reconhece e encerra com status `caixa_postal`, sem deixar recado.

Precisa de `npm run atualizar-agente`.

---

## Ainda pendente: ouvir o telefone chamando

Você pediu para, enquanto a ligação está tentando, ouvir o celular chamando —
o toque, o "tá chamando".

Isso não dá para entregar com o desenho atual, e vale entender por quê. Hoje
**a ElevenLabs origina** a chamada pela SIP trunk: ela disca e conecta o agente
assim que a operadora atende. O Asterisk só repassa o áudio depois. Não existe
um ponto onde o toque da chamada passe por nós antes de alguém atender.

Para ouvir o telefone chamando, o caminho de saída precisa inverter: **o
Asterisk origina** a chamada (aí o toque passa por ele e dá para transmitir ao
painel, como já fazemos com a escuta ao vivo), espera atenderem, e só então
conecta a ElevenLabs.

Esse mesmo redesenho resolveria de forma definitiva a caixa postal que atende:
o Asterisk faz detecção de atendimento (AMD) e distingue humano de gravação
antes de gastar o agente.

É um passo dedicado — reescreve o disparo de saída. A detecção de caixa postal
por roteiro (acima) cobre a maioria dos casos enquanto isso.


---

## Ajustes de conteúdo, latência e correio de voz

### Linhas de produto da retirada
Televisão, Monitor, Tablet, Celular, SmartWatch, Fone de ouvido. A triagem
mantém a lista completa (inclui linha branca); a retirada usa só portáteis e
telas.

### Pagamento: "Orçamento recusado"
Nova opção. O agente explica que o reparo NÃO foi feito porque o orçamento não
foi aprovado, e o produto está disponível no mesmo estado. Se o cliente
perguntar de reembolso, o agente não confirma nem nega valor: informa que essa
informação é passada na loja, na retirada.

### Latência
Já estava otimizada; empurramos ao máximo: `optimize_streaming_latency: 4` e
`turn_timeout: 2s` (era 7). O agente começa a responder mais cedo depois que o
cliente para de falar. Rode `atualizar-agente` para aplicar.

### Alucinação de detalhe técnico (LED virando LCD)
O roteiro agora ordena repetir o serviço EXATAMENTE como está escrito, com o
exemplo LED/LCD explícito. Simplificar é permitido ("troca de uma peça"),
trocar por termo parecido não é.

### Não iniciar conversa com a caixa postal
A primeira fala do agente ficou vazia — ele aguarda a outra ponta falar antes
de se apresentar. Se vier gravação em vez de "alô", ele reconhece e encerra sem
gastar a apresentação. Precisa de `atualizar-agente`.

### Ouvir o celular chamando
Enquanto a chamada está discando, o cartão mostra "Chamando o celular…" com um
botão **Ouvir**. Você acompanha o toque em tempo real, antes de alguém atender.
Depende do ARI configurado, igual à escuta normal.


---

## Latência ajustável pelo painel

Em **Ajustes**, seção "Velocidade de resposta". Dois controles, aplicados no
agente na hora:

**Espera antes de responder** (turn_timeout, 1–6s) — quanto o agente aguarda o
cliente parar de falar antes de responder. Menor é mais ágil; muito baixo corta
quem fala pausado. Comece em 2s e desça ouvindo.

**Prioridade de velocidade do áudio** (0–4) — 0 é o áudio mais suave, 4 o mais
rápido. Em ligação, 4 quase sempre compensa.

Ficam no painel porque o ponto certo se acha ouvindo, não no código. O valor
vive no banco e sobrepõe o padrão do `atualizar-agente`; salvar faz o PATCH no
agente na hora, sem redeploy.

Se o agente começar a atropelar o cliente, suba a espera meio segundo. É o único
ajuste com contrapartida — a prioridade de áudio é ganho quase puro.
