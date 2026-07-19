import type { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase.js';
import { triagem } from '../services/triagem.js';
import { mensageria } from '../services/mensageria.js';
import { voz } from '../services/voice-provider.js';
import type { ToolName } from '../agent/tools.js';

interface ToolCallBody {
  call_id: string;
  name: ToolName;
  args: Record<string, any>;
}

/**
 * Todo handler retorna { fala: string } — texto curto que o agente lê ou usa
 * para formular a próxima frase. Nunca retorne JSON cru: o TTS vai ler.
 */
export async function rotasTools(app: FastifyInstance) {
  app.post<{ Body: ToolCallBody }>('/webhooks/tool-call', async (req, reply) => {
    const { call_id, name, args } = req.body;
    const { data: chamada } = await supabase
      .from('chamadas_triagem')
      .select('id, os_numero, produto_modelo, produto_linha')
      .eq('provider_call_id', call_id)
      .single();

    if (!chamada) return reply.code(404).send({ fala: 'Erro interno.' });

    req.log.info({ call_id, name, args }, 'tool_call');

    switch (name) {
      case 'confirmar_cadastro': {
        await supabase.from('chamadas_triagem').update({
          cadastro_nome: args.nome,
          cadastro_endereco: args.endereco,
          cadastro_cep: args.cep ?? null,
          cadastro_referencia: args.ponto_referencia ?? null,
          restricao_horario: args.restricao_horario ?? null,
          cadastro_corrigido: args.houve_correcao,
          etapa: 'cadastro_ok',
        }).eq('id', chamada.id);

        return {
          fala: args.houve_correcao
            ? 'Cadastro atualizado.'
            : 'Cadastro confirmado.',
        };
      }

      case 'consultar_codigo_erro': {
        // RAG existente do Triagem AI
        const r = await triagem.buscarCodigoErro({
          codigo: args.codigo,
          linha: args.linha,
          modelo: args.modelo ?? chamada.produto_modelo,
        });

        if (!r) {
          return {
            fala: `Não localizei o código ${soletrar(args.codigo)} para este modelo. Peça ao cliente para conferir o que aparece no painel.`,
          };
        }

        await supabase.from('chamadas_triagem').update({
          codigo_erro: args.codigo,
          codigo_erro_descricao: r.descricao,
        }).eq('id', chamada.id);

        // descricao_leiga: campo curto, sem jargão, pensado para TTS
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

        await supabase.from('chamadas_triagem').update({
          sintoma_confirmado: args.sintoma_confirmado,
          sintoma_inicio: args.inicio ?? null,
          sintoma_frequencia: args.frequencia,
          sintoma_fatores: args.fatores ?? [],
          divergiu_abertura: args.divergiu_da_abertura,
          triagem_analise: analise,
          etapa: 'sintoma_ok',
        }).eq('id', chamada.id);

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

        await supabase.from('chamadas_triagem').update({
          doc_canal: args.canal,
          doc_telefone: args.telefone,
          doc_enviado_em: new Date().toISOString(),
          etapa: 'doc_enviado',
        }).eq('id', chamada.id);

        return {
          fala: `Link enviado por ${args.canal === 'whatsapp' ? 'WhatsApp' : 'mensagem de texto'}. Peça ao cliente para confirmar se recebeu.`,
        };
      }

      case 'transferir_humano': {
        await supabase.from('chamadas_triagem').update({
          status: 'transferida',
          transferencia_motivo: args.motivo,
        }).eq('id', chamada.id);

        await voz.transferir(call_id, process.env.RAMAL_ATENDIMENTO!);
        return { fala: 'Vou te transferir para um atendente. Um momento.' };
      }

      case 'encerrar_triagem': {
        await supabase.from('chamadas_triagem').update({
          status: args.status,
          observacao: args.observacao ?? null,
          finalizada_em: new Date().toISOString(),
        }).eq('id', chamada.id);

        await voz.encerrar(call_id);
        return { fala: 'Triagem encerrada.' };
      }

      default:
        return reply.code(400).send({ fala: 'Erro interno.' });
    }
  });
}

/** "CH38" -> "C H 3 8" — evita o TTS ler como palavra. */
function soletrar(s: string) {
  return s.toUpperCase().split('').join(' ');
}
