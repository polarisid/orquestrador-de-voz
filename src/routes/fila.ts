import type { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase.js';
import { enfileirar, lerTabela } from '../services/fila.js';
import { FLUXOS } from '../agent/fluxos.js';

export async function rotasFila(app: FastifyInstance) {
  app.get('/fila', async () => {
    const { data } = await supabase.from('fila').select('*');
    const fila = ((data ?? []) as any[]).sort((a, b) =>
      (a.criada_em ?? '').localeCompare(b.criada_em ?? ''),
    );

    const resumo = fila.reduce<Record<string, number>>((acc, f) => {
      acc[f.status] = (acc[f.status] ?? 0) + 1;
      return acc;
    }, {});

    return { resumo, itens: fila.slice(0, 200) };
  });

  /** Recebe texto colado de planilha (CSV, TSV ou ponto e vírgula). */
  app.post<{ Body: { fluxo: string; tabela?: string; itens?: Record<string, string>[] } }>(
    '/fila',
    async (req, reply) => {
      const { fluxo, tabela, itens } = req.body ?? {};
      if (!FLUXOS[fluxo]) return reply.code(400).send({ erro: 'fluxo desconhecido' });

      const lista = itens ?? (tabela ? lerTabela(tabela, fluxo) : []);
      if (!lista.length) {
        return reply.code(400).send({
          erro: 'nada_para_enfileirar',
          mensagem: 'Cole os dados com uma linha de cabeçalho e pelo menos uma linha de dados.',
        });
      }

      return enfileirar(fluxo, lista);
    },
  );

  /** Modelo de planilha do fluxo, para o operador copiar e preencher. */
  app.get<{ Params: { id: string } }>('/fila/modelo/:id', async (req, reply) => {
    const f = FLUXOS[req.params.id];
    if (!f) return reply.code(404).send({ erro: 'fluxo não encontrado' });

    // Valor com vírgula quebraria o próprio CSV que estamos gerando.
    const csv = (v: string) => (v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v);

    const cabecalho = f.campos.map((c) => csv(c.rotulo)).join(',');
    const exemplo = f.campos
      .map((c) => csv(c.tipo === 'select' ? c.opcoes?.[0]?.valor ?? '' : c.exemplo ?? ''))
      .join(',');

    return reply.type('text/csv; charset=utf-8').send(`${cabecalho}\n${exemplo}\n`);
  });

  app.delete<{ Params: { id: string } }>('/fila/:id', async (req) => {
    await supabase.from('fila').update({ status: 'cancelada' }).eq('id', req.params.id);
    return { ok: true };
  });

  /** Limpa itens já finalizados; nunca toca em pendente ou discada. */
  app.post('/fila/limpar', async () => {
    const { data } = await supabase.from('fila').select('*');
    const acabados = ((data ?? []) as any[]).filter((f) =>
      ['concluida', 'sem_contato', 'falhou', 'cancelada'].includes(f.status),
    );
    for (const a of acabados) {
      await supabase.from('fila').update({ status: 'arquivada' }).eq('id', a.id);
    }
    return { arquivados: acabados.length };
  });
}
