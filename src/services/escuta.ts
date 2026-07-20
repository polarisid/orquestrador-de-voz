import { createSocket, type Socket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import WebSocket from 'ws';

/**
 * Escuta ao vivo.
 *
 * A ElevenLabs não expõe o áudio da ligação. Mas o áudio passa fisicamente
 * pelo nosso Asterisk, então bifurcamos ali:
 *
 *   canal da ligação
 *        │
 *        ├─ snoop (spy=both) ──┐
 *        │                     ├─ bridge mixing ──► externalMedia ──RTP──► este processo
 *        │                     │                                              │
 *        └─ segue normal       │                                        WebSocket ──► navegador
 *
 * O snoop é somente leitura: o cliente e o agente não ouvem nada do ouvinte.
 */

const APP = 'triagem-escuta';

import { urlAri } from './rede.js';

const base = urlAri;
const usuario = () => process.env.ARI_USUARIO ?? 'triagem';
const senha = () => process.env.ARI_SENHA ?? '';

export const escutaDisponivel = () => Boolean(senha());

async function ari(caminho: string, method = 'GET', params?: Record<string, string>) {
  const url = new URL(base() + caminho);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

  const auth = Buffer.from(`${usuario()}:${senha()}`).toString('base64');
  const r = await fetch(url, {
    method,
    headers: { authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`ari ${method} ${caminho}: ${r.status} ${await r.text()}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

/**
 * O Asterisk exige que a aplicação Stasis esteja registrada, senão os canais
 * criados morrem na hora. Manter este WebSocket aberto é o registro.
 */
let eventos: WebSocket | null = null;

export function registrarApp(log: { info: Function; warn: Function }) {
  if (!escutaDisponivel() || eventos) return;

  const url = base().replace(/^http/, 'ws') +
    `/events?app=${APP}&subscribeAll=true&api_key=${encodeURIComponent(`${usuario()}:${senha()}`)}`;

  const ws = new WebSocket(url);
  eventos = ws;

  ws.on('open', () => log.info('[escuta] app ARI registrada'));
  ws.on('error', (e: Error) => log.warn({ e: String(e) }, '[escuta] erro no ARI'));
  ws.on('close', () => {
    eventos = null;
    // Reconecta: sem a app registrada, a escuta para de funcionar em silêncio.
    setTimeout(() => registrarApp(log), 10_000).unref();
  });
}

/** IP deste processo na rede do Docker — é para cá que o Asterisk manda o RTP. */
function meuIp(): string {
  if (process.env.ESCUTA_HOST) return process.env.ESCUTA_HOST;
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista ?? []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

const digitos = (s: string) => String(s ?? '').replace(/\D/g, '');

async function acharCanal(telefone: string) {
  const alvo = digitos(telefone);
  const canais: any[] = (await ari('/channels')) ?? [];
  return canais.find((c) =>
    [c.dialplan?.exten, c.connected?.number, c.caller?.number]
      .map(digitos)
      .some((n) => n.length >= 8 && n.slice(-8) === alvo.slice(-8)),
  );
}

export interface Sessao {
  parar(): Promise<void>;
}

/**
 * Abre a escuta e entrega os quadros de áudio no callback.
 * O formato é µ-law 8 kHz, um pacote RTP por vez (20 ms, 160 bytes).
 */
export async function abrirEscuta(
  telefone: string,
  aoReceber: (quadro: Buffer) => void,
  log: { warn: Function },
): Promise<Sessao> {
  const canal = await acharCanal(telefone);
  if (!canal) throw new Error('nenhum canal ativo para este telefone');

  const udp: Socket = createSocket('udp4');
  await new Promise<void>((ok, falha) => {
    udp.once('error', falha);
    udp.bind(0, '0.0.0.0', () => ok());
  });
  const porta = udp.address().port;

  udp.on('message', (pacote) => {
    // Cabeçalho RTP tem 12 bytes fixos; o resto é o áudio.
    if (pacote.length > 12) aoReceber(pacote.subarray(12));
  });

  let bridge: any, snoop: any, midia: any;

  try {
    bridge = await ari('/bridges', 'POST', { type: 'mixing' });

    midia = await ari('/channels/externalMedia', 'POST', {
      app: APP,
      external_host: `${meuIp()}:${porta}`,
      format: 'ulaw',
      encapsulation: 'rtp',
      transport: 'udp',
      direction: 'both',
    });

    snoop = await ari(`/channels/${encodeURIComponent(canal.id)}/snoop`, 'POST', {
      spy: 'both',
      whisper: 'none',
      app: APP,
    });

    await ari(`/bridges/${bridge.id}/addChannel`, 'POST', {
      channel: `${snoop.id},${midia.id}`,
    });
  } catch (e) {
    udp.close();
    // Limpa o que já tinha sido criado, senão sobram canais órfãos no Asterisk.
    for (const c of [snoop, midia]) {
      if (c?.id) await ari(`/channels/${encodeURIComponent(c.id)}`, 'DELETE').catch(() => {});
    }
    if (bridge?.id) await ari(`/bridges/${bridge.id}`, 'DELETE').catch(() => {});
    throw e;
  }

  let parada = false;
  return {
    async parar() {
      if (parada) return;
      parada = true;
      try { udp.close(); } catch {}
      for (const c of [snoop, midia]) {
        if (c?.id) {
          await ari(`/channels/${encodeURIComponent(c.id)}`, 'DELETE')
            .catch((e) => log.warn({ e: String(e) }, '[escuta] falha ao remover canal'));
        }
      }
      if (bridge?.id) await ari(`/bridges/${bridge.id}`, 'DELETE').catch(() => {});
    },
  };
}
