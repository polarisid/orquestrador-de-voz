import type { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase.js';
import { voz } from '../services/voice-provider.js';
import { normalizar } from '../services/transcricao.js';
import { FLUXOS, fluxoPadrao } from '../agent/fluxos.js';
import { ariConfigurado, desligarPorTelefone } from '../services/asterisk.js';

/** Status em que a chamada acabou de vez — só aí o cache vale. */
const ENCERRADOS = [
  'concluida', 'parcial', 'recusou_gravacao', 'cliente_desligou',
  'nao_e_o_titular', 'sem_contato', 'transferida', 'encerrada_pelo_operador',
];

/** Campos de cadastro que o cliente pode ter corrigido na ligação. */
const CAMPOS_CADASTRO: { chave: string; original: string; rotulo: string }[] = [
  { chave: 'cadastro_nome', original: 'cadastro_nome_original', rotulo: 'Nome' },
  { chave: 'cadastro_endereco', original: 'cadastro_endereco_original', rotulo: 'Endereço' },
];

export async function rotasConversa(app: FastifyInstance) {
  /**
   * Tudo que o operador precisa para fechar a OS, num payload só:
   * o que mudou no cadastro, o que a triagem concluiu, o que falta.
   */
  app.get<{ Params: { id: string } }>('/calls/:id/detalhe', async (req, reply) => {
    const { data: c } = await supabase
      .from('chamadas_triagem')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (!c) return reply.code(404).send({ erro: 'chamada não encontrada' });

    const encerrada = ENCERRADOS.includes(c.status ?? '');

    // Transcrição: cache só quando encerrada; no ar, sempre busca.
    let transcricao = c.transcricao ?? [];
    let resumo = c.resumo ?? null;
    let duracao = c.duracao_segundos ?? 0;

    // Array vazio é valor válido em JS mas não é transcrição. Sem esta
    // checagem, uma busca feita cedo demais congela o "sem transcrição".
    if (!encerrada || !(c.transcricao?.length > 0)) {
      try {
        const conv: any = await voz.conversa(c.provider_call_id);
        transcricao = normalizar(conv.transcript);
        resumo = conv.analysis?.transcript_summary ?? resumo;
        duracao = conv.metadata?.call_duration_secs ?? duracao;
        await supabase
          .from('chamadas_triagem')
          .update({ transcricao, resumo, duracao_segundos: duracao })
          .eq('id', c.id);
      } catch (e) {
        req.log.warn({ e: String(e) }, 'conversa indisponivel');
      }
    }

    // O que divergiu entre o cadastro da OS e o que o cliente confirmou.
    // Compara ignorando pontuação, acento e caixa: "Rua X 04" e "Rua X, 04"
    // são o mesmo endereço, e sinalizar isso como correção gera ruído.
    const canonico = (v: string) =>
      String(v ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const correcoes = CAMPOS_CADASTRO.filter(
      (f) => c[f.chave] && canonico(c[f.chave]) !== canonico(c[f.original]),
    ).map((f) => ({
      rotulo: f.rotulo,
      antes: c[f.original] ?? '',
      depois: c[f.chave],
    }));

    // Dados que a OS não tinha e a ligação trouxe.
    const novos = [
      c.cadastro_cep && { rotulo: 'CEP', valor: c.cadastro_cep },
      c.cadastro_referencia && { rotulo: 'Ponto de referência', valor: c.cadastro_referencia },
      c.restricao_horario && { rotulo: 'Restrição de horário', valor: c.restricao_horario },
    ].filter(Boolean);

    // Cada fluxo sabe o que é pendência no seu contexto.
    const fluxo = FLUXOS[c.fluxo ?? fluxoPadrao] ?? FLUXOS[fluxoPadrao];
    const pendencias = encerrada
      ? [
          ...(fluxo.pendencias?.(c) ?? []),
          ...(c.status === 'transferida' ? ['Cliente pediu atendente humano'] : []),
        ]
      : [];

    return {
      encerrada,
      revisada: Boolean(c.revisada_em),
      resumo,
      duracao_segundos: duracao,
      transcricao,
      correcoes,
      novos,
      pendencias,
      sintoma: c.sintoma_confirmado
        ? {
            confirmado: c.sintoma_confirmado,
            inicio: c.sintoma_inicio,
            frequencia: c.sintoma_frequencia,
            fatores: c.sintoma_fatores ?? [],
            codigo_erro: c.codigo_erro,
            codigo_erro_descricao: c.codigo_erro_descricao,
            divergiu: c.divergiu_abertura,
          }
        : null,
      triagem: c.triagem_analise ?? null,
      documentos: c.doc_enviado_em
        ? { canal: c.doc_canal, enviado_em: c.doc_enviado_em }
        : null,
      observacao: c.observacao ?? null,

      // Campos que só existem em alguns fluxos. O painel mostra o que vier.
      resultado: [
        c.agendamento_confirmado != null && {
          rotulo: 'Visita',
          valor: c.agendamento_confirmado ? 'confirmada' : 'NÃO confirmada',
          alerta: !c.agendamento_confirmado,
        },
        c.agendamento_nova_preferencia && {
          rotulo: 'Prefere', valor: c.agendamento_nova_preferencia, alerta: true,
        },
        c.agendamento_motivo && { rotulo: 'Motivo', valor: c.agendamento_motivo },
        c.retirada_quem && { rotulo: 'Quem retira', valor: c.retirada_quem },
        c.retirada_titular === false && {
          rotulo: 'Atenção', valor: 'não é o titular — exigir documento', alerta: true,
        },
        c.retirada_previsao && { rotulo: 'Previsão', valor: c.retirada_previsao },
      ].filter(Boolean),
    };
  });

  /** Marca que um humano já olhou e agiu. Tira o cartão da fila de revisão. */
  app.post<{ Params: { id: string } }>('/calls/:id/revisar', async (req, reply) => {
    const { data: c } = await supabase
      .from('chamadas_triagem')
      .select('id, revisada_em')
      .eq('id', req.params.id)
      .single();
    if (!c) return reply.code(404).send({ erro: 'chamada não encontrada' });

    const novo = c.revisada_em ? null : new Date().toISOString();
    await supabase.from('chamadas_triagem').update({ revisada_em: novo }).eq('id', c.id);
    return { revisada: Boolean(novo) };
  });

  /** Desliga a ligação em andamento derrubando o canal no Asterisk. */
  app.post<{ Params: { id: string } }>('/calls/:id/desligar', async (req, reply) => {
    if (!ariConfigurado()) {
      return reply.code(503).send({
        erro: 'ari_nao_configurado',
        mensagem: 'Preencha ARI_SENHA e ASTERISK_ARI_URL para poder desligar pelo painel.',
      });
    }

    const { data: c } = await supabase
      .from('chamadas_triagem')
      .select('id, telefone, status')
      .eq('id', req.params.id)
      .single();
    if (!c) return reply.code(404).send({ erro: 'chamada não encontrada' });

    try {
      const derrubados = await desligarPorTelefone(c.telefone);
      await supabase
        .from('chamadas_triagem')
        .update({
          status: 'encerrada_pelo_operador',
          finalizada_em: new Date().toISOString(),
          observacao: 'Ligação encerrada manualmente pelo painel.',
        })
        .eq('id', c.id);

      return { ok: true, canais_derrubados: derrubados };
    } catch (e) {
      req.log.error({ e: String(e) }, 'falha ao desligar');
      return reply.code(502).send({
        erro: 'falha_ari',
        mensagem: 'Não consegui falar com o Asterisk. Abra /diagnostico para ver o motivo.',
        detalhe: String(e),
      });
    }
  });

  app.get<{ Params: { id: string } }>('/calls/:id/audio', async (req, reply) => {
    const { data: chamada } = await supabase
      .from('chamadas_triagem')
      .select('provider_call_id')
      .eq('id', req.params.id)
      .single();

    if (!chamada) return reply.code(404).send({ erro: 'chamada não encontrada' });

    try {
      const bytes = await voz.audio(chamada.provider_call_id);
      return reply.type('audio/mpeg').send(Buffer.from(bytes));
    } catch (e) {
      req.log.warn({ e: String(e) }, 'audio indisponivel');
      return reply.code(502).send({ erro: 'áudio indisponível' });
    }
  });
}
