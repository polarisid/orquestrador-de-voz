/**
 * Ponte com o Triagem AI já existente. Não reimplementa o RAG —
 * chama os endpoints que você já tem no Next.js.
 */
const BASE = process.env.TRIAGEM_API_URL!;
const KEY = process.env.TRIAGEM_API_KEY!;

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`triagem ${path}: ${r.status}`);
  return r.json() as Promise<T>;
}

export const triagem = {
  buscarCodigoErro(p: { codigo: string; linha: string; modelo?: string }) {
    return post<{ descricao: string; descricaoLeiga?: string; causas: string[] } | null>(
      '/api/codigos-erro/lookup',
      p,
    );
  },

  analisar(p: {
    osNumero: string;
    linha: string;
    modelo: string;
    sintoma: string;
    inicio?: string;
    frequencia: string;
    codigoErro?: string;
    fatores: string[];
  }) {
    return post<{
      hipoteses: { causa: string; confianca: number }[];
      pecas_provaveis: string[];
      boletins: string[];
      recomendacao_tecnico: string;
    }>('/api/triagem/analisar', p);
  },
};
