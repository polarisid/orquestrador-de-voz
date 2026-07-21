import { supabase } from './supabase.js';

/**
 * Configuração editável pelo painel.
 *
 * Mora no banco, não em variável de ambiente: trocar o ramal de transbordo é
 * decisão de operação, e operação não pode depender de redeploy. A variável de
 * ambiente continua servindo de valor inicial.
 */
export async function lerConfig(chave: string, padrao = ''): Promise<string> {
  const { data } = await supabase.from('config').select('valor').eq('chave', chave).single();
  return data?.valor ?? padrao;
}

export async function gravarConfig(chave: string, valor: string) {
  const agora = new Date().toISOString();
  const { data } = await supabase.from('config').select('id').eq('chave', chave).single();

  if (data) await supabase.from('config').update({ valor, atualizado_em: agora }).eq('id', data.id);
  else await supabase.from('config').insert({ chave, valor, atualizado_em: agora });

  return agora;
}

/** Destino do transbordo: o do painel, ou o do ambiente como valor inicial. */
export const destinoTransbordo = () =>
  lerConfig('transbordo', process.env.NUMERO_TRANSBORDO ?? '');
