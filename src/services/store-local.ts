/**
 * Store local em arquivo JSON, com a MESMA API encadeada do supabase-js
 * para os métodos que este projeto usa:
 *
 *   from(t).select(cols).eq(c, v).single()
 *   from(t).update(obj).eq(c, v)
 *   from(t).insert(obj)
 *   from(t).insert(obj).select('id').single()
 *
 * Quando você quiser plugar o Supabase de verdade, basta preencher
 * SUPABASE_URL no .env — nenhum outro arquivo muda.
 *
 * Persiste em ./dados/store.json. Apague o arquivo para zerar.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type Linha = Record<string, any>;
const ARQUIVO = resolve(process.cwd(), 'dados/store.json');

function carregar(): Record<string, Linha[]> {
  if (!existsSync(ARQUIVO)) return {};
  try {
    return JSON.parse(readFileSync(ARQUIVO, 'utf8'));
  } catch {
    return {};
  }
}

const dados = carregar();

function salvar() {
  mkdirSync(dirname(ARQUIVO), { recursive: true });
  writeFileSync(ARQUIVO, JSON.stringify(dados, null, 2));
}

function tabela(nome: string): Linha[] {
  dados[nome] ??= [];
  return dados[nome];
}

/** Valores default que o Postgres preencheria por nós. */
function comDefaults(t: string, linha: Linha): Linha {
  const base: Linha = {
    id: crypto.randomUUID(),
    criada_em: new Date().toISOString(),
  };
  if (t === 'chamadas_triagem') {
    base.tentativas = 0;
    base.cadastro_corrigido = false;
    base.etapa = 'abertura';
    base.status = 'pendente';
  }
  if (t === 'uploads_os') {
    base.criado_em = new Date().toISOString();
    base.documentos_recebidos = [];
    base.expira_em = new Date(Date.now() + 7 * 864e5).toISOString();
  }
  return { ...base, ...linha };
}

class Query implements PromiseLike<{ data: any; error: null }> {
  private filtros: [string, any][] = [];
  private colunas: string[] | null = null;

  constructor(
    private t: string,
    private op: 'select' | 'update' | 'insert',
    private payload?: Linha,
  ) {}

  select(cols?: string) {
    this.colunas = cols && cols !== '*' ? cols.split(',').map((c) => c.trim()) : null;
    if (this.op === 'insert') return this;
    this.op = 'select';
    return this;
  }

  eq(coluna: string, valor: any) {
    this.filtros.push([coluna, valor]);
    return this;
  }

  private casa(l: Linha) {
    return this.filtros.every(([c, v]) => l[c] === v);
  }

  private projetar(l: Linha | undefined) {
    if (!l) return null;
    if (!this.colunas) return { ...l };
    return Object.fromEntries(this.colunas.map((c) => [c, l[c]]));
  }

  private executar(): any[] {
    const tb = tabela(this.t);

    if (this.op === 'insert') {
      const nova = comDefaults(this.t, this.payload!);
      tb.push(nova);
      salvar();
      console.log(`[store] insert ${this.t} id=${nova.id}`);
      return [nova];
    }

    const alvos = tb.filter((l) => this.casa(l));

    if (this.op === 'update') {
      for (const l of alvos) Object.assign(l, this.payload);
      salvar();
      console.log(
        `[store] update ${this.t} (${alvos.length}) -> ${Object.keys(this.payload!).join(', ')}`,
      );
      return alvos;
    }

    return alvos;
  }

  single() {
    const [primeira] = this.executar();
    if (!primeira) {
      return Promise.resolve({
        data: null,
        error: { message: 'nenhuma linha encontrada' },
      });
    }
    return Promise.resolve({ data: this.projetar(primeira), error: null });
  }

  then<R1 = { data: any; error: null }, R2 = never>(
    onOk?: ((v: { data: any; error: null }) => R1 | PromiseLike<R1>) | null,
    onErr?: ((r: any) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    try {
      const linhas = this.executar();
      return Promise.resolve({ data: linhas.map((l) => this.projetar(l)), error: null }).then(
        onOk,
        onErr,
      );
    } catch (e) {
      return Promise.reject(e).then(onOk, onErr);
    }
  }
}

export const storeLocal = {
  from(t: string) {
    return {
      select: (cols?: string) => new Query(t, 'select').select(cols),
      update: (obj: Linha) => new Query(t, 'update', obj),
      insert: (obj: Linha) => new Query(t, 'insert', obj),
    };
  },
};
