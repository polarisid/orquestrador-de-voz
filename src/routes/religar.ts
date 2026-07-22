import type { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase.js';
import { dispararChamada } from './disparo.js';
import { FLUXOS } from '../agent/fluxos.js';

/** Estados em que faz sentido tentar de novo: ninguém foi atendido de fato. */
const RELIGAVEIS = [
  'sem_contato', 'cliente_desligou', 'reagendar',
  'recusou_gravacao', 'nao_e_o_titular', 'encerrada_pelo_operador',
];

/**
 * Liga de novo reusando os dados da chamada anterior.
 *
 * Reaproveita o mesmo formulário — nada é redigitado. A chamada nova é
 * independente: entra na lista como qualquer outra, com o histórico da
 * anterior preservado por meio do campo tentativa_de.
 */
export async function rotasReligar(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/calls/:id/religar', async (req, reply) => {
    const { data: original } = await supabase
      .from('chamadas_triagem')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (!original) return reply.code(404).send({ erro: 'chamada não encontrada' });

    const fluxo = FLUXOS[original.fluxo ?? 'triagem'];
    if (!fluxo) return reply.code(400).send({ erro: 'fluxo desconhecido' });

    // Os dados do formulário ficam salvos em 'dados'; versões antigas podem
    // não ter, então reconstruímos do que houver.
    const dados =
      original.dados && Object.keys(original.dados).length
        ? original.dados
        : reconstruir(original);

    if (process.env.DRY_RUN !== 'true' && !dentroDaJanela()) {
      return reply.code(202).send({ status: 'fora_da_janela' });
    }

    try {
      const nova = await dispararChamada(original.fluxo ?? 'triagem', dados);
      await supabase
        .from('chamadas_triagem')
        .update({ tentativa_de: original.id })
        .eq('id', nova.id);

      return { chamada_id: nova.id };
    } catch (e) {
      req.log.error({ e: String(e) }, 'falha ao religar');
      return reply.code(502).send({
        erro: 'falha_ao_ligar',
        mensagem: 'A chamada não saiu. Verifique o tronco e tente de novo.',
      });
    }
  });
}

/** Para chamadas antigas sem o campo 'dados' preenchido. */
function reconstruir(c: any): Record<string, string> {
  return {
    os_numero: c.os_numero ?? '',
    telefone: c.telefone ?? '',
    cliente_nome: c.cadastro_nome_original ?? c.cadastro_nome ?? '',
    cliente_endereco: c.cadastro_endereco_original ?? '',
    produto_modelo: c.produto_modelo ?? '',
    produto_linha: c.produto_linha ?? '',
    sintoma_declarado: c.sintoma_declarado ?? '',
    garantia: c.garantia ?? 'a_confirmar',
  };
}

function dentroDaJanela(d = new Date()) {
  const br = new Date(d.toLocaleString('en-US', { timeZone: 'America/Maceio' }));
  const h = br.getHours();
  return br.getDay() !== 0 && h >= 8 && h < 20;
}

export { RELIGAVEIS };
