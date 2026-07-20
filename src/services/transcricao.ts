/**
 * Formato único de transcrição para o painel.
 * O webhook pós-chamada e a busca sob demanda chegam pelo mesmo caminho,
 * então os dois precisam gravar a mesma forma — senão o painel mostra
 * falas vazias dependendo de qual escreveu primeiro.
 */
export interface Fala {
  quem: 'agente' | 'cliente';
  texto: string;
  segundo: number;
}

export function normalizar(bruto: unknown): Fala[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((t: any) => ({
    quem: t.role === 'agent' ? 'agente' : 'cliente',
    texto: t.message ?? t.texto ?? '',
    segundo: t.time_in_call_secs ?? t.segundo ?? 0,
  }));
}
