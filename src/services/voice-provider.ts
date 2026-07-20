/**
 * Adapter da ElevenLabs Agents.
 *
 * Diferença estrutural em relação a um provedor genérico: o agente é criado
 * UMA VEZ (prompt, voz, tools) e cada chamada só passa variáveis dinâmicas
 * e, opcionalmente, um override de prompt. Por isso não mandamos as tools
 * aqui — elas ficam registradas no agente.
 *
 * Criação do agente: scripts/criar-agente-elevenlabs.mjs
 */
// ELEVENLABS_API_URL só é usado nos testes locais, apontando para o mock.
const BASE = () => process.env.ELEVENLABS_API_URL ?? 'https://api.elevenlabs.io/v1';
const KEY = () => process.env.ELEVENLABS_API_KEY!;

async function api(path: string, body?: unknown, method = 'POST') {
  const r = await fetch(`${BASE()}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'xi-api-key': KEY() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`elevenlabs ${path}: ${r.status} ${txt}`);
  return txt ? JSON.parse(txt) : {};
}

export interface DadosChamada {
  os: string;
  clienteNome: string;
  clienteEndereco: string;
  produtoModelo: string;
  produtoLinha: string;
  sintomaDeclarado: string;
}

export const voz = {
  /**
   * Dispara a ligação. Retorna { id } = conversation_id da ElevenLabs, que é
   * o identificador que volta em toda tool call e no webhook de encerramento.
   */
  async originar(p: {
    destino: string;
    prompt?: string;
    primeiraFala?: string;
    dados: DadosChamada;
  }): Promise<{ id: string; sipCallId?: string }> {
    const overrides: Record<string, any> = {};
    if (p.prompt) overrides.prompt = { prompt: p.prompt };
    if (p.primeiraFala) overrides.first_message = p.primeiraFala;

    const r = await api('/convai/sip-trunk/outbound-call', {
      agent_id: process.env.ELEVENLABS_AGENT_ID,
      agent_phone_number_id: process.env.ELEVENLABS_PHONE_NUMBER_ID,
      to_number: p.destino, // E.164, ex: +5579999998888
      conversation_initiation_client_data: {
        // Ficam disponíveis no prompt como {{os_numero}}, {{cliente_nome}}, etc.
        dynamic_variables: {
          os_numero: p.dados.os,
          cliente_nome: p.dados.clienteNome,
          cliente_endereco: p.dados.clienteEndereco,
          produto_modelo: p.dados.produtoModelo,
          produto_linha: p.dados.produtoLinha,
          sintoma_declarado: p.dados.sintomaDeclarado,
        },
        ...(Object.keys(overrides).length
          ? { conversation_config_override: { agent: overrides } }
          : {}),
      },
    });

    if (!r.success) throw new Error(`elevenlabs recusou a chamada: ${r.message}`);
    return { id: r.conversation_id, sipCallId: r.sip_call_id };
  },

  /** Detalhes da conversa: transcrição, duração, análise. */
  async conversa(conversationId: string) {
    return api(`/convai/conversations/${conversationId}`, undefined, 'GET');
  },

  /** Áudio da gravação. Devolve os bytes crus para o painel tocar. */
  async audio(conversationId: string): Promise<ArrayBuffer> {
    const r = await fetch(`${BASE()}/convai/conversations/${conversationId}/audio`, {
      headers: { 'xi-api-key': KEY() },
    });
    if (!r.ok) throw new Error(`audio ${conversationId}: ${r.status}`);
    return r.arrayBuffer();
  },

  /**
   * Transferência: na ElevenLabs isso é uma transfer rule configurada no
   * próprio agente (transfer_to_number), não uma chamada de API.
   * A tool aqui só registra a intenção; quem executa é o agente.
   */
  async transferir(_conversationId: string, _destino: string) {
    return;
  },

  /**
   * Encerramento idem: o agente encerra sozinho ao chamar end_call.
   * Mantido para a interface continuar igual.
   */
  async encerrar(_conversationId: string) {
    return;
  },
};
