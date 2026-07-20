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
