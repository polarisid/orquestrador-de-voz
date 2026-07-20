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

/**
 * A ElevenLabs emite marcações de entonação entre colchetes ([Empathetically],
 * [laughs]) dentro do texto. Elas não são faladas, então não devem aparecer
 * na transcrição que o operador lê.
 */
const limpar = (t: string) =>
  String(t ?? '')
    .replace(/\[[^\]]{1,40}\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

export function normalizar(bruto: unknown): Fala[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .map((t: any) => ({
      quem: (t.role === 'agent' ? 'agente' : 'cliente') as Fala['quem'],
      texto: limpar(t.message ?? t.texto ?? ''),
      segundo: t.time_in_call_secs ?? t.segundo ?? 0,
    }))
    // Turnos de tool call vêm sem texto e viravam bolhas vazias no painel.
    .filter((f) => f.texto.length > 0);
}
