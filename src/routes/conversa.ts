import type { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase.js';
import { voz } from '../services/voice-provider.js';
import { normalizar } from '../services/transcricao.js';

/** Status em que a chamada acabou de vez — só aí o cache vale. */
const ENCERRADOS = [
  'concluida', 'parcial', 'recusou_gravacao', 'cliente_desligou',
  'nao_e_o_titular', 'sem_contato', 'transferida',
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

    if (!encerrada || !c.transcricao) {
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
    const correcoes = CAMPOS_CADASTRO.filter(
      (f) => c[f.chave] && c[f.chave] !== c[f.original],
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

    const pendencias: string[] = [];
    if (encerrada) {
      if (!c.cadastro_nome) pendencias.push('Cadastro não foi confirmado na ligação');
      if (!c.sintoma_confirmado) pendencias.push('Sintoma não foi confirmado');
      if (!c.doc_enviado_em) pendencias.push('Link de documentos não foi enviado');
      if (c.status === 'transferida') pendencias.push('Cliente pediu atendente humano');
      if (c.divergiu_abertura) pendencias.push('Sintoma real difere do informado na abertura da OS');
    }

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
