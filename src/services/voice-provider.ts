/**
 * Adapter do provedor de voz. Trocar de LiveKit/Vapi/Retell = mexer só aqui.
 * O tronco SIP da iFalei é cadastrado no painel do provedor; este código
 * apenas referencia o trunkId.
 */
const BASE = process.env.VOICE_API_URL!;
const KEY = process.env.VOICE_API_KEY!;

async function call(path: string, body?: unknown, method = 'POST') {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`voice-provider ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

export const voz = {
  originar(p: {
    destino: string;
    prompt: string;
    tools: unknown[];
    trunkId: string;
    callerId: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    return call('/calls', {
      to: p.destino,
      from: p.callerId,
      sip_trunk_id: p.trunkId,
      agent: {
        system_prompt: p.prompt,
        tools: p.tools,
        tool_webhook_url: `${process.env.PUBLIC_URL}/webhooks/tool-call`,
        language: 'pt-BR',
        // Latência: prefira região BR. Cada 100ms conta na percepção do cliente.
        region: 'sa-east-1',
        stt: { model: 'nova-3', language: 'pt-BR', endpointing_ms: 350 },
        tts: { voice: process.env.TTS_VOICE, speed: 1.0 },
        interruption_enabled: true,
        max_duration_seconds: 600,
        voicemail_detection: true,
      },
      webhook_url: `${process.env.PUBLIC_URL}/webhooks/call-event`,
      metadata: p.metadata,
    });
  },

  transferir(callId: string, ramal: string) {
    return call(`/calls/${callId}/transfer`, { to: ramal });
  },

  encerrar(callId: string) {
    return call(`/calls/${callId}/end`, {});
  },
};
