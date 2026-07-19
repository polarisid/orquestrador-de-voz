# Orquestrador de Triagem por Voz

Ponte entre o **Triagem AI** e a telefonia **iFalei**, para ligação ativa ao cliente.

## Fluxo da chamada

1. **Abertura** — identificação + aviso de gravação (LGPD). Recusa encerra a chamada.
2. **Cadastro** — confirma nome, depois endereço, ponto de referência e restrição de horário. → `confirmar_cadastro`
3. **Sintoma** — confirma o que veio na OS e investiga: início, frequência, código de erro, fatores. → `consultar_codigo_erro`, `registrar_sintoma`
4. **Documentação** — nota fiscal + foto da etiqueta de série, link por WhatsApp ou SMS. → `enviar_link_documentos`
5. **Encerramento** — resumo em uma frase. → `encerrar_triagem`

Escape a qualquer momento: `transferir_humano`.

## Arquitetura

```
Triagem AI (Next.js)
  └─ POST /calls ─────────► Orquestrador (este serviço)
                              ├─ voice-provider ──► agente de voz ──► tronco SIP iFalei ──► cliente
                              ├─ /webhooks/tool-call  ◄── tool calls do agente
                              │     └─ triagem.ts ──► RAG do Triagem AI
                              ├─ /webhooks/call-event ◄── answered / ended / no_answer
                              └─ Supabase (chamadas_triagem, uploads_os)
```

## Setup

```bash
npm install
cp .env.example .env      # preencher
# rodar src/db/schema.sql no Supabase
npm run dev
```

Disparo:

```bash
curl -X POST localhost:3001/calls -H 'content-type: application/json' -d '{
  "os_numero": "4181234567",
  "cliente_nome": "Maria da Silva",
  "cliente_endereco": "Rua X, 100, Farolândia, Aracaju",
  "telefone": "79999998888",
  "produto_modelo": "AR12BVHZCWK",
  "produto_linha": "RAC",
  "sintoma_declarado": "não gela"
}'
```

## Pendências antes de produção

- [ ] Confirmar com o suporte iFalei se o tronco pode terminar em IP de terceiro
- [ ] Obter `usuario_id_origem` (só o suporte fornece)
- [ ] Aprovar template de WhatsApp na Meta
- [ ] Trocar `WEBHOOK_SECRET` por HMAC real do provedor (o preHandler atual é placeholder)
- [ ] Definir retenção das gravações e do transcript (LGPD — sugerido 6 meses)
- [ ] Medir latência ponta a ponta em ligação real antes de escalar
