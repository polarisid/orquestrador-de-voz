import type { FastifyInstance } from 'fastify';
import { networkInterfaces } from 'node:os';
import { gatewayPadrao, urlAri } from '../services/rede.js';

/**
 * Diagnóstico da ponte com o Asterisk.
 *
 * Existe porque "502 Bad Gateway" não diz nada útil: pode ser endereço errado,
 * firewall, senha do ARI ou o container Asterisk parado. Aqui cada uma dessas
 * hipóteses vira uma linha com veredito.
 */
/** Deriva a faixa /16 a partir do gateway, para a regra de firewall. */
function faixa(gw: string | null) {
  if (!gw) return '10.0.0.0/8';
  const [a, b] = gw.split('.');
  return `${a}.${b}.0.0/16`;
}

export async function rotasDiagnostico(app: FastifyInstance) {
  app.get('/diagnostico', async () => {
    const ips = Object.values(networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i!.address);

    const gw = gatewayPadrao();
    const url = urlAri();
    const senha = process.env.ARI_SENHA ?? '';

    const rede = {
      ip_do_orquestrador: ips,
      gateway_detectado: gw,
      url_ari_em_uso: url,
      ari_url_fixada_no_env: Boolean(process.env.ASTERISK_ARI_URL),
      ari_senha_preenchida: Boolean(senha),
    };

    if (!senha) {
      return {
        ...rede,
        ari: 'sem_senha',
        sugestao: 'Preencha ARI_SENHA com o mesmo valor de telefonia/.env.',
      };
    }

    // Endereços que valem tentar quando o configurado falha.
    const candidatos = [url];
    if (gw && !url.includes(gw)) candidatos.push(`http://${gw}:8088/ari`);
    for (const extra of ['172.17.0.1', '10.0.1.1', 'host.docker.internal']) {
      if (!candidatos.some((c) => c.includes(extra))) candidatos.push(`http://${extra}:8088/ari`);
    }

    const auth = Buffer.from(`${process.env.ARI_USUARIO ?? 'triagem'}:${senha}`).toString('base64');
    const tentativas: Record<string, string> = {};
    let funcionou: string | null = null;

    for (const c of candidatos) {
      try {
        const r = await fetch(`${c}/asterisk/info`, {
          headers: { authorization: `Basic ${auth}` },
          signal: AbortSignal.timeout(2500),
        });
        if (r.ok) {
          const info: any = await r.json();
          tentativas[c] = `ok — Asterisk ${info?.system?.version ?? ''}`.trim();
          funcionou ??= c;
        } else if (r.status === 401) {
          tentativas[c] = 'alcançável, mas a senha do ARI está errada';
        } else {
          tentativas[c] = `resposta ${r.status}`;
        }
      } catch (e) {
        tentativas[c] = String(e).includes('timeout')
          ? 'sem resposta — firewall bloqueando ou endereço errado'
          : 'não alcançável';
      }
    }

    return {
      ...rede,
      tentativas,
      ari: funcionou ? 'ok' : 'inalcancavel',
      sugestao: funcionou
        ? funcionou === url
          ? 'Tudo certo.'
          : `Funciona em ${funcionou}. Ponha isso em ASTERISK_ARI_URL e refaça o deploy.`
        : [
            'Nenhum endereço respondeu. No servidor, nesta ordem:',
            `1) libere a porta: ufw allow from ${faixa(gw)} to any port 8088 proto tcp`,
            `2) confira se o ARI está no ar: docker exec asterisk-triagem asterisk -rx "ari show status"`,
            '3) se ainda falhar, rode "ip -4 addr" no host e ponha o IP da interface da rede do container em ASTERISK_ARI_URL.',
          ].join(' '),
    };
  });
}
