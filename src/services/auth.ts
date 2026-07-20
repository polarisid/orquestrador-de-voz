/**
 * Autenticação via Supabase Auth.
 *
 * O navegador faz login direto no Supabase (chave anon, pública por design) e
 * manda o access_token em Authorization. Aqui só validamos o token contra o
 * Supabase e guardamos o resultado por poucos minutos — validar a cada
 * requisição multiplicaria a latência do painel sem ganho real.
 *
 * Sem SUPABASE_URL configurado, a autenticação fica DESLIGADA. É o que permite
 * rodar local com os mocks, mas nunca deixe assim num domínio público.
 */
const cache = new Map<string, { email: string; expira: number }>();
const VALIDADE_MS = 5 * 60_000;

export const authAtiva = () =>
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);

export async function validarToken(token: string): Promise<{ email: string } | null> {
  const agora = Date.now();

  const guardado = cache.get(token);
  if (guardado && guardado.expira > agora) return { email: guardado.email };

  // Limpeza preguiçosa: sem isso o mapa cresce para sempre.
  if (cache.size > 200) {
    for (const [k, v] of cache) if (v.expira <= agora) cache.delete(k);
  }

  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY!,
        authorization: `Bearer ${token}`,
      },
    });
    if (!r.ok) return null;
    const u: any = await r.json();
    if (!u?.id) return null;

    cache.set(token, { email: u.email ?? u.id, expira: agora + VALIDADE_MS });
    return { email: u.email ?? u.id };
  } catch {
    return null;
  }
}
