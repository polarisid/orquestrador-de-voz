import { readFileSync } from 'node:fs';

/**
 * Gateway padrão deste container.
 *
 * O Asterisk roda em rede host; o orquestrador, em container. Para alcançar o
 * host a partir do container usamos o gateway da rede em que o container está.
 * Chutar 172.17.0.1 só funciona na bridge padrão do Docker — o Coolify cria
 * redes próprias (10.0.x.x), e aí o endereço é outro.
 *
 * Lemos de /proc/net/route: a linha com destino 00000000 é a rota padrão, e o
 * gateway vem em hexadecimal little-endian.
 */
export function gatewayPadrao(): string | null {
  try {
    const linhas = readFileSync('/proc/net/route', 'utf8').trim().split('\n').slice(1);
    for (const l of linhas) {
      const [, destino, gateway] = l.split(/\s+/);
      if (destino !== '00000000' || !gateway) continue;
      const n = parseInt(gateway, 16);
      return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff].join('.');
    }
  } catch {}
  return null;
}

/** Base da API ARI. Respeita ASTERISK_ARI_URL; senão descobre sozinho. */
export function urlAri(): string {
  if (process.env.ASTERISK_ARI_URL) {
    return process.env.ASTERISK_ARI_URL.replace(/\/$/, '');
  }
  const gw = gatewayPadrao() ?? '172.17.0.1';
  return `http://${gw}:8088/ari`;
}
