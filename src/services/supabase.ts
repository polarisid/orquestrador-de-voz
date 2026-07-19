/**
 * Camada de dados. Sem SUPABASE_URL no .env, usa um store local em
 * ./dados/store.json com a mesma API. Nenhum outro arquivo do projeto
 * precisa saber qual dos dois está ativo.
 */
import { storeLocal } from './store-local.js';

let cliente: any;

if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const { createClient } = await import('@supabase/supabase-js');
  cliente = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  console.log('[dados] Supabase');
} else {
  cliente = storeLocal;
  console.log('[dados] store local em ./dados/store.json');
}

export const supabase = cliente;
