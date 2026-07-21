import type { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase.js';
import { triagem } from '../services/triagem.js';
import { mensageria } from '../services/mensageria.js';
import { voz } from '../services/voice-provider.js';
import { desligarDepois } from '../services/asterisk.js';
import type { ToolName } from '../agent/tools.js';

/**
 * Toda tool devolve { fala } — texto curto e falável. O agente lê esse retorno
 * em voz alta ou o usa para formular a próxima frase. Nunca devolva JSON cru:
 * o TTS vai ler literalmente.
 *
 * Retorna null quando a chamada não existe no banco.
 */
export async function executarTool(
  providerCallId: string,
  name: ToolName,
  args: Record<string, any>,
): Promise<{ fala: string } | null> {
  const { data: chamada } = await supabase
    .from('chamadas_triagem')
    .select('id, os_numero, produto_modelo, produto_linha, status, telefone')
    .eq('provider_call_id', providerCallId)
    .single();

  if (!chamada) return null;

  // A ElevenLabs nao manda evento de atendimento. A primeira tool call e a
  // prova de que o cliente atendeu e a conversa comecou.
  if (chamada.status === 'discando') {
    await supabase
      .from('chamadas_triagem')
      .update({ status: 'em_andamento', atendida_em: new Date().toISOString() })
      .eq('id', chamada.id);
  }

  switch (name) {
    case 'confirmar_cadastro': {
      await supabase
        .from('chamadas_triagem')
        .update({
          cadastro_nome: args.nome,
          cadastro_endereco: args.endereco,
          cadastro_cep: args.cep ?? null,
          cadastro_referencia: args.ponto_referencia ?? null,
          restricao_horario: args.restricao_horario ?? null,
          cadastro_corrigido: Boolean(args.houve_correcao),
          etapa: 'cadastro_ok',
        })
        .eq('id', chamada.id);

      return {
        fala: args.houve_correcao ? 'Cadastro atualizado.' : 'Cadastro confirmado.',
      };
    }

    case 'consultar_codigo_erro': {
      const r = await triagem.buscarCodigoErro({
        codigo: args.codigo,
        linha: args.linha ?? chamada.produto_linha,
        modelo: args.modelo ?? chamada.produto_modelo,
      });

      if (!r) {
        return {
          fala: `Não localizei o código ${soletrar(args.codigo)} para este modelo. Peça ao cliente para conferir o que aparece no painel.`,
        };
      }

      await supabase
        .from('chamadas_triagem')
        .update({ codigo_erro: args.codigo, codigo_erro_descricao: r.descricao })
        .eq('id', chamada.id);

      return { fala: r.descricaoLeiga ?? r.descricao };
    }

    case 'registrar_sintoma': {
      const analise = await triagem.analisar({
        osNumero: chamada.os_numero,
        linha: chamada.produto_linha,
        modelo: chamada.produto_modelo,
        sintoma: args.sintoma_confirmado,
        inicio: args.inicio,
        frequencia: args.frequencia,
        codigoErro: args.codigo_erro,
        fatores: args.fatores ?? [],
      });

      await supabase
        .from('chamadas_triagem')
        .update({
          sintoma_confirmado: args.sintoma_confirmado,
          sintoma_inicio: args.inicio ?? null,
          sintoma_frequencia: args.frequencia,
          sintoma_fatores: args.fatores ?? [],
          divergiu_abertura: Boolean(args.divergiu_da_abertura),
          triagem_analise: analise,
          etapa: 'sintoma_ok',
        })
        .eq('id', chamada.id);

      // A análise NÃO vai para o cliente — é insumo do técnico.
      return { fala: 'Anotado.' };
    }

    case 'enviar_link_documentos': {
      const token = crypto.randomUUID();
      await supabase.from('uploads_os').insert({
        chamada_id: chamada.id,
        os_numero: chamada.os_numero,
        token,
        documentos_exigidos: ['nota_fiscal', 'etiqueta_serie'],
      });

      const url = `${process.env.PORTAL_URL}/envio/${token}`;
      await mensageria.enviar({
        canal: args.canal,
        telefone: args.telefone,
        texto: `Smart Center Aracaju - OS ${chamada.os_numero}. Envie a nota fiscal e a foto da etiqueta do produto por aqui: ${url}`,
      });

      await supabase
        .from('chamadas_triagem')
        .update({
          doc_canal: args.canal,
          doc_telefone: args.telefone,
          doc_enviado_em: new Date().toISOString(),
          etapa: 'doc_enviado',
        })
        .eq('id', chamada.id);

      return {
        fala: `Link enviado por ${args.canal === 'whatsapp' ? 'WhatsApp' : 'mensagem de texto'}. Peça ao cliente para confirmar se recebeu.`,
      };
    }

    case 'confirmar_aviso_retirada': {
      await supabase
        .from('chamadas_triagem')
        .update({ etapa: 'aviso_ok', observacao: args.reacao ?? null })
        .eq('id', chamada.id);
      return { fala: 'Anotado.' };
    }

    case 'registrar_retirada': {
      await supabase
        .from('chamadas_triagem')
        .update({
          retirada_quem: args.quem_retira,
          retirada_titular: Boolean(args.e_o_titular),
          retirada_previsao: args.previsao ?? null,
          observacao: args.observacao ?? null,
          etapa: 'retirada_ok',
        })
        .eq('id', chamada.id);

      return {
        fala: args.e_o_titular
          ? 'Anotado.'
          : 'Anotado. Lembre que quem retira precisa levar documento com foto.',
      };
    }

    case 'registrar_agendamento': {
      await supabase
        .from('chamadas_triagem')
        .update({
          agendamento_confirmado: Boolean(args.confirmou),
          agendamento_nova_preferencia: args.nova_preferencia ?? null,
          agendamento_motivo: args.motivo ?? null,
          ...(args.endereco_confirmado ? { cadastro_endereco: args.endereco_confirmado } : {}),
          etapa: 'confirmado',
        })
        .eq('id', chamada.id);

      return {
        fala: args.confirmou
          ? 'Visita confirmada.'
          : 'Anotado. Diga que o atendimento entra em contato para remarcar — não prometa data.',
      };
    }

    case 'transferir_humano': {
      await supabase
        .from('chamadas_triagem')
        .update({ status: 'transferida', transferencia_motivo: args.motivo })
        .eq('id', chamada.id);

      await voz.transferir(providerCallId, process.env.RAMAL_ATENDIMENTO!);
      return { fala: 'Vou te transferir para um atendente. Um momento.' };
    }

    case 'encerrar_triagem': {
      await supabase
        .from('chamadas_triagem')
        .update({
          status: args.status,
          observacao: args.observacao ?? null,
          finalizada_em: new Date().toISOString(),
        })
        .eq('id', chamada.id);

      await voz.encerrar(providerCallId);
      // O agente deve encerrar sozinho; isto é o seguro contra ele não encerrar.
      desligarDepois(chamada.telefone, console);
      return { fala: 'Triagem encerrada.' };
    }

    default:
      return { fala: 'Não consegui executar essa ação.' };
  }
}

/** "CH38" -> "C H 3 8". Evita o TTS ler o código como palavra. */
function soletrar(s: string) {
  return String(s).toUpperCase().split('').join(' ');
}

export async function rotasTools(app: FastifyInstance) {
  /** Formato genérico, usado pelos mocks e por provedores que mandam o nome no corpo. */
  app.post<{ Body: { call_id: string; name: ToolName; args: Record<string, any> } }>(
    '/webhooks/tool-call',
    async (req, reply) => {
      const { call_id, name, args } = req.body;
      req.log.info({ call_id, name, args }, 'tool_call');
      const r = await executarTool(call_id, name, args ?? {});
      return r ?? reply.code(404).send({ fala: 'Chamada não encontrada.' });
    },
  );

  /**
   * ElevenLabs: uma URL por tool, argumentos na raiz do corpo.
   * O conversation_id entra como variável dinâmica declarada no corpo da tool
   * — ver scripts/criar-agente-elevenlabs.mjs.
   */
  app.post<{
    Params: { tool: ToolName };
    Body: Record<string, any> & { conversation_id?: string };
  }>('/webhooks/el/:tool', async (req, reply) => {
    const { conversation_id, ...args } = req.body ?? {};
    if (!conversation_id) {
      return reply.code(400).send({ fala: 'Sem identificador da conversa.' });
    }
    req.log.info({ conversation_id, tool: req.params.tool, args }, 'tool_call_elevenlabs');
    const r = await executarTool(conversation_id, req.params.tool, args);
    return r ?? reply.code(404).send({ fala: 'Chamada não encontrada.' });
  });
}
