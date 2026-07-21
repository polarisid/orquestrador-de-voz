/**
 * Aplica configuração no agente da ElevenLabs.
 *
 * O destino da transferência vive na config do agente, não na chamada. Por isso
 * mudar o ramal pelo painel exige um PATCH lá — é o que esta função faz,
 * mexendo só no que precisa e sem tocar no roteiro.
 */
const BASE = () => process.env.ELEVENLABS_API_URL ?? 'https://api.elevenlabs.io/v1';

function tools(destino: string) {
  const end_call = {
    type: 'system',
    name: 'end_call',
    description: 'Encerra a ligação depois da despedida, quando a conversa chegou ao fim.',
    params: { system_tool_type: 'end_call' },
  };

  if (!destino) return { end_call };

  return {
    end_call,
    transfer_to_number: {
      type: 'system',
      name: 'transfer_to_number',
      description: 'Transfere a ligação para o atendimento humano da Smart Center.',
      params: {
        system_tool_type: 'transfer_to_number',
        transfers: [
          {
            transfer_destination: destino.startsWith('sip:')
              ? { type: 'sip_uri', sip_uri: destino }
              : { type: 'phone', phone_number: destino },
            condition:
              'O cliente pediu para falar com uma pessoa, demonstrou irritação, ' +
              'perguntou valores, ou houve duas falhas seguidas de entendimento.',
            transfer_type: 'conference',
          },
        ],
      },
    },
  };
}

export async function aplicarTransbordo(destino: string) {
  const agente = process.env.ELEVENLABS_AGENT_ID;
  const chave = process.env.ELEVENLABS_API_KEY;
  if (!agente || !chave) throw new Error('ELEVENLABS_AGENT_ID ou ELEVENLABS_API_KEY ausente');

  const r = await fetch(`${BASE()}/convai/agents/${agente}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'xi-api-key': chave },
    body: JSON.stringify({
      conversation_config: { agent: { prompt: { built_in_tools: tools(destino) } } },
    }),
  });

  if (!r.ok) throw new Error(`elevenlabs ${r.status}: ${(await r.text()).slice(0, 400)}`);
}
