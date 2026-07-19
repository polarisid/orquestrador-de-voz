/**
 * Tools expostas ao agente de voz. O provedor (LiveKit/Vapi/Retell) chama
 * POST /webhooks/tool-call com { name, args, call_id }.
 *
 * Regra de ouro: toda tool retorna string curta e falável. O agente vai LER
 * o retorno em voz alta ou usá-lo para formular a próxima fala.
 */

export const TOOLS = [
  {
    name: 'confirmar_cadastro',
    description:
      'Registra nome e endereço confirmados ou corrigidos pelo cliente. Chame apenas depois que o cliente confirmar ambos verbalmente.',
    parameters: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome completo confirmado' },
        endereco: {
          type: 'string',
          description: 'Logradouro, número, complemento, bairro, cidade',
        },
        cep: { type: 'string' },
        ponto_referencia: { type: 'string' },
        restricao_horario: {
          type: 'string',
          description: 'Ex: "só à tarde", "não pode segunda". Vazio se nenhuma.',
        },
        houve_correcao: {
          type: 'boolean',
          description: 'true se algum dado divergiu do cadastro original',
        },
      },
      required: ['nome', 'endereco', 'houve_correcao'],
    },
  },
  {
    name: 'consultar_codigo_erro',
    description:
      'Consulta a base técnica Samsung quando o cliente cita um código de erro no painel. Retorna a descrição em linguagem simples.',
    parameters: {
      type: 'object',
      properties: {
        codigo: { type: 'string', description: 'Ex: E1, CH38, 5E' },
        linha: {
          type: 'string',
          enum: ['RAC', 'REF', 'WSM', 'TV', 'MWO', 'OUTRO'],
        },
        modelo: { type: 'string' },
      },
      required: ['codigo', 'linha'],
    },
  },
  {
    name: 'registrar_sintoma',
    description:
      'Grava a triagem do sintoma e dispara a análise do Triagem AI. Chame uma única vez, ao final da etapa 3.',
    parameters: {
      type: 'object',
      properties: {
        sintoma_confirmado: {
          type: 'string',
          description: 'Descrição técnica do problema, em uma ou duas frases',
        },
        inicio: {
          type: 'string',
          description: 'Quando começou. Ex: "há 3 dias", "desde a instalação"',
        },
        frequencia: {
          type: 'string',
          enum: ['constante', 'intermitente', 'nao_informado'],
        },
        codigo_erro: { type: 'string' },
        fatores: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Eventos relatados: queda de energia, mudança de local, instalação recente, infiltração, etc.',
        },
        divergiu_da_abertura: { type: 'boolean' },
      },
      required: ['sintoma_confirmado', 'frequencia', 'divergiu_da_abertura'],
    },
  },
  {
    name: 'enviar_link_documentos',
    description:
      'Envia por WhatsApp ou SMS o link de upload da nota fiscal e da foto da etiqueta do produto.',
    parameters: {
      type: 'object',
      properties: {
        canal: { type: 'string', enum: ['whatsapp', 'sms'] },
        telefone: {
          type: 'string',
          description: 'Somente dígitos, com DDD. Ex: 79999998888',
        },
      },
      required: ['canal', 'telefone'],
    },
  },
  {
    name: 'transferir_humano',
    description:
      'Transfere a ligação para um atendente. Use quando o cliente pedir, demonstrar irritação, ou após duas falhas seguidas de entendimento.',
    parameters: {
      type: 'object',
      properties: {
        motivo: {
          type: 'string',
          enum: [
            'pedido_do_cliente',
            'insatisfacao',
            'falha_entendimento',
            'fora_do_escopo',
          ],
        },
      },
      required: ['motivo'],
    },
  },
  {
    name: 'encerrar_triagem',
    description: 'Finaliza a triagem e a chamada.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: [
            'concluida',
            'parcial',
            'recusou_gravacao',
            'cliente_desligou',
            'nao_e_o_titular',
          ],
        },
        observacao: { type: 'string' },
      },
      required: ['status'],
    },
  },
] as const;

export type ToolName = (typeof TOOLS)[number]['name'];
