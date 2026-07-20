/**
 * Controle do Asterisk via ARI.
 *
 * Usamos o Asterisk e não a ElevenLabs para desligar porque o áudio passa
 * fisicamente por aqui — derrubar o canal encerra a ligação de verdade,
 * independente do que o agente esteja fazendo.
 *
 * O orquestrador roda em container do Coolify; o Asterisk roda em rede host.
 * Por isso o endereço padrão é o gateway da bridge do Docker, não 127.0.0.1.
 */
const URL_BASE = () => process.env.ASTERISK_ARI_URL ?? 'http://172.17.0.1:8088/ari';
const USUARIO = () => process.env.ARI_USUARIO ?? 'triagem';
const SENHA = () => process.env.ARI_SENHA ?? '';

export const ariConfigurado = () => Boolean(SENHA());

async function ari(caminho: string, method = 'GET') {
  const auth = Buffer.from(`${USUARIO()}:${SENHA()}`).toString('base64');
  const r = await fetch(`${URL_BASE()}${caminho}`, {
    method,
    headers: { authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`ari ${caminho}: ${r.status} ${await r.text()}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

/** Só os dígitos, para comparar números escritos de formas diferentes. */
const digitos = (s: string) => String(s ?? '').replace(/\D/g, '');

/**
 * Derruba o canal cujo destino casa com o telefone.
 * Retorna quantos canais foram encerrados.
 */
export async function desligarPorTelefone(telefone: string): Promise<number> {
  const alvo = digitos(telefone);
  if (alvo.length < 8) return 0;

  const canais: any[] = (await ari('/channels')) ?? [];
  let derrubados = 0;

  for (const c of canais) {
    const candidatos = [
      c.dialplan?.exten,
      c.connected?.number,
      c.caller?.number,
    ].map(digitos);

    // Compara pelos últimos 8 dígitos: o mesmo numero aparece com e sem
    // DDI/DDD dependendo da perna da chamada.
    const casa = candidatos.some((n) => n.length >= 8 && n.slice(-8) === alvo.slice(-8));
    if (!casa) continue;

    await ari(`/channels/${encodeURIComponent(c.id)}`, 'DELETE');
    derrubados++;
  }

  return derrubados;
}
