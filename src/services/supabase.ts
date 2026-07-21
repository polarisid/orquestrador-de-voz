/**
 * Camada de dados. Sem SUPABASE_URL no .env, usa um store local em
 * ./dados/store.json com a mesma API. Nenhum outro arquivo do projeto
 * precisa saber qual dos dois está ativo.
 */
import { storeLocal } from './store-local.js';

let cliente: any;

if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = await import('@supabase/supabase-js');
  // Schema dedicado: o projeto Supabase pode ter outras tabelas em uso, e
  // nada aqui deve encostar nelas.
  const schema = process.env.SUPABASE_SCHEMA ?? 'voz';
  cliente = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false }, db: { schema } },
  );
  console.log(`[dados] Supabase, schema "${schema}"`);
} else {
  cliente = storeLocal;
  console.log('[dados] store local em ./dados/store.json');
}

export const supabase = cliente;
