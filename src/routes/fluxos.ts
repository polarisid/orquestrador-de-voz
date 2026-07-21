import type { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase.js';
import { FLUXOS, fluxoPadrao } from '../agent/fluxos.js';

/**
 * O painel monta o formulário e o trilho de etapas a partir daqui, então
 * criar um tipo novo de ligação é mexer só em src/agent/fluxos.ts.
 *
 * O roteiro editado no painel fica salvo por fluxo e passa a valer para as
 * próximas chamadas. É o que permite iterar no prompt sem tocar em código.
 */
export async function rotasFluxos(app: FastifyInstance) {
  app.get('/fluxos', async () => ({
    padrao: fluxoPadrao,
    fluxos: Object.values(FLUXOS).map((f) => ({
      id: f.id,
      nome: f.nome,
      descricao: f.descricao,
      etapas: f.etapas,
      campos: f.campos,
    })),
  }));

  /** Roteiro em vigor: o salvo, se houver; senão o padrão do código. */
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/fluxos/:id/roteiro',
    async (req, reply) => {
      const fluxo = FLUXOS[req.params.id];
      if (!fluxo) return reply.code(404).send({ erro: 'fluxo não encontrado' });

      const exemplo = Object.fromEntries(
        fluxo.campos.map((c) => [c.nome, req.query[c.nome] || `(${c.rotulo.toLowerCase()})`]),
      );

      const { data } = await supabase
        .from('roteiros')
        .select('texto, salvo_em')
        .eq('fluxo', fluxo.id)
        .single();

      return {
        padrao: fluxo.montarPrompt(exemplo),
        salvo: data?.texto ?? null,
        salvo_em: data?.salvo_em ?? null,
      };
    },
  );

  /**
   * Salva o roteiro do fluxo. Texto vazio volta ao padrão do código —
   * é a saída quando uma edição piora a conversa.
   */
  app.put<{ Params: { id: string }; Body: { texto?: string } }>(
    '/fluxos/:id/roteiro',
    async (req, reply) => {
      const fluxo = FLUXOS[req.params.id];
      if (!fluxo) return reply.code(404).send({ erro: 'fluxo não encontrado' });

      const texto = (req.body?.texto ?? '').trim();
      const { data: existente } = await supabase
        .from('roteiros')
        .select('id')
        .eq('fluxo', fluxo.id)
        .single();

      if (!texto) {
        if (existente) await supabase.from('roteiros').update({ texto: null }).eq('id', existente.id);
        return { salvo: false, mensagem: 'Voltou ao roteiro padrão.' };
      }

      const agora = new Date().toISOString();
      if (existente) {
        await supabase.from('roteiros').update({ texto, salvo_em: agora }).eq('id', existente.id);
      } else {
        await supabase.from('roteiros').insert({ fluxo: fluxo.id, texto, salvo_em: agora });
      }
      return { salvo: true, salvo_em: agora };
    },
  );
}

/** Roteiro que vale para uma chamada: o salvo do fluxo, ou o padrão. */
export async function roteiroEmVigor(
  fluxoId: string,
  dados: Record<string, string>,
): Promise<string> {
  const fluxo = FLUXOS[fluxoId] ?? FLUXOS[fluxoPadrao];
  const { data } = await supabase
    .from('roteiros')
    .select('texto')
    .eq('fluxo', fluxo.id)
    .single();

  if (!data?.texto) return fluxo.montarPrompt(dados);

  // O roteiro salvo usa {{campo}} para os dados da OS.
  return data.texto.replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => dados[k] ?? `{{${k}}}`);
}
