import type { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase.js';
import { voz } from '../services/voice-provider.js';
import { FLUXOS, fluxoPadrao } from '../agent/fluxos.js';
import { roteiroEmVigor } from './fluxos.js';

interface DisparoBody {
  fluxo?: string;
  /** Campos do formulário do fluxo. */
  dados: Record<string, string>;
  /** Roteiro editado só para esta chamada. Vazio = usa o do fluxo. */
  roteiro?: string;
}

export async function rotasDisparo(app: FastifyInstance) {
  app.get('/calls', async () => {
    const { data } = await supabase.from('chamadas_triagem').select('*');
    return ((data ?? []) as any[])
      .sort((a, b) => (b.criada_em ?? '').localeCompare(a.criada_em ?? ''))
      .slice(0, 40);
  });

  app.post<{ Body: DisparoBody }>('/calls', async (req, reply) => {
    const faltando = ['ELEVENLABS_API_KEY', 'ELEVENLABS_AGENT_ID', 'ELEVENLABS_PHONE_NUMBER_ID']
      .filter((v) => !process.env[v]);
    if (faltando.length) {
      req.log.error({ faltando }, 'configuracao_incompleta');
      return reply.code(503).send({
        erro: 'configuracao_incompleta',
        faltando,
        mensagem: 'Preencha estas variáveis de ambiente e refaça o deploy.',
      });
    }

    const fluxoId = req.body.fluxo ?? fluxoPadrao;
    const fluxo = FLUXOS[fluxoId];
    if (!fluxo) return reply.code(400).send({ erro: 'fluxo desconhecido' });

    const d = req.body.dados ?? {};
    const faltandoCampo = fluxo.campos
      .filter((c) => c.obrigatorio && !String(d[c.nome] ?? '').trim())
      .map((c) => c.rotulo);
    if (faltandoCampo.length) {
      return reply.code(400).send({ erro: 'campos_obrigatorios', faltando: faltandoCampo });
    }

    // Janela permitida: 8h-20h, seg-sáb. DRY_RUN=true ignora (só em teste).
    if (process.env.DRY_RUN !== 'true' && !dentroDaJanela()) {
      return reply.code(202).send({ status: 'agendada_proxima_janela' });
    }

    const prompt = req.body.roteiro?.trim() || (await roteiroEmVigor(fluxoId, d));

    const chamada = await voz.originar({
      destino: `+55${String(d.telefone).replace(/\D/g, '')}`,
      prompt,
      // Tudo do formulário vira variável dinâmica, então um roteiro salvo
      // pode usar {{qualquer_campo}} sem eu precisar mexer em código.
      dados: d,
    });

    const { data } = await supabase
      .from('chamadas_triagem')
      .insert({
        fluxo: fluxoId,
        dados: d,
        os_numero: d.os_numero,
        provider_call_id: chamada.id,
        sip_call_id: chamada.sipCallId ?? null,
        telefone: d.telefone,
        produto_modelo: d.produto_modelo ?? null,
        produto_linha: d.produto_linha ?? null,
        sintoma_declarado: d.sintoma_declarado ?? null,
        garantia: d.garantia ?? null,
        cadastro_nome_original: d.cliente_nome ?? null,
        cadastro_endereco_original: d.cliente_endereco ?? null,
        roteiro_customizado: Boolean(req.body.roteiro?.trim()),
        status: 'discando',
        etapa: 'abertura',
      })
      .select('id')
      .single();

    return { chamada_id: data?.id, provider_call_id: chamada.id };
  });
}

function dentroDaJanela(d = new Date()) {
  const br = new Date(d.toLocaleString('en-US', { timeZone: 'America/Maceio' }));
  const h = br.getHours();
  return br.getDay() !== 0 && h >= 8 && h < 20;
}
