import type { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase.js';
import { voz } from '../services/voice-provider.js';

interface DisparoBody {
  os_numero: string;
  cliente_nome: string;
  cliente_endereco: string;
  telefone: string;          // somente dígitos, com DDD
  produto_modelo: string;
  produto_linha: string;     // RAC | REF | WSM | TV | MWO
  sintoma_declarado: string;
  /** em_garantia | fora_garantia | a_confirmar */
  garantia: 'em_garantia' | 'fora_garantia' | 'a_confirmar';
  /** Roteiro editado no painel. Vazio = o agente usa o prompt padrão dele. */
  roteiro?: string;
}

export async function rotasDisparo(app: FastifyInstance) {
  // Lista para o painel. Mais recentes primeiro.
  app.get('/calls', async () => {
    const { data } = await supabase.from('chamadas_triagem').select('*');
    const linhas = (data ?? []) as any[];
    return linhas
      .sort((a, b) => (b.criada_em ?? '').localeCompare(a.criada_em ?? ''))
      .slice(0, 40);
  });

  app.post<{ Body: DisparoBody }>('/calls', async (req, reply) => {
    const b = req.body;

    // Erra cedo e com mensagem clara, em vez de deixar a API devolver 422.
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

    // Janela permitida: 8h-20h, seg-sáb. DRY_RUN=true ignora (só em teste).
    if (process.env.DRY_RUN !== 'true' && !dentroDaJanela()) {
      return reply.code(202).send({ status: 'agendada_proxima_janela' });
    }

    const chamada = await voz.originar({
      destino: `+55${b.telefone}`,
      prompt: b.roteiro?.trim() || undefined,
      dados: {
        os: b.os_numero,
        clienteNome: b.cliente_nome,
        clienteEndereco: b.cliente_endereco,
        produtoModelo: b.produto_modelo,
        produtoLinha: b.produto_linha,
        sintomaDeclarado: b.sintoma_declarado,
        garantia: b.garantia ?? 'a_confirmar',
      },
    });

    const { data } = await supabase
      .from('chamadas_triagem')
      .insert({
        os_numero: b.os_numero,
        provider_call_id: chamada.id,      // conversation_id da ElevenLabs
        sip_call_id: chamada.sipCallId ?? null,
        telefone: b.telefone,
        produto_modelo: b.produto_modelo,
        produto_linha: b.produto_linha,
        sintoma_declarado: b.sintoma_declarado,
        garantia: b.garantia ?? 'a_confirmar',
        cadastro_nome_original: b.cliente_nome,
        cadastro_endereco_original: b.cliente_endereco,
        roteiro_customizado: Boolean(b.roteiro?.trim()),
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
  const dia = br.getDay(); // 0 = domingo
  return dia !== 0 && h >= 8 && h < 20;
}
