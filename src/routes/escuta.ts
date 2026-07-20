import type { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase.js';
import { abrirEscuta, escutaDisponivel } from '../services/escuta.js';
import { validarToken, authAtiva } from '../services/auth.js';

/**
 * WebSocket de escuta ao vivo.
 *
 *   ws://.../escuta/<id da chamada>?token=<access_token do Supabase>
 *
 * O token vai na query porque o navegador não permite cabeçalhos
 * personalizados ao abrir um WebSocket.
 */
export async function rotasEscuta(app: FastifyInstance) {
  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/escuta/:id',
    { websocket: true },
    async (conexao, req) => {
      const fechar = (motivo: string) => {
        try {
          conexao.send(JSON.stringify({ erro: motivo }));
          conexao.close();
        } catch {}
      };

      if (authAtiva()) {
        const u = req.query.token ? await validarToken(req.query.token) : null;
        if (!u) return fechar('nao_autenticado');
      }

      if (!escutaDisponivel()) return fechar('ari_nao_configurado');

      const { data: c } = await supabase
        .from('chamadas_triagem')
        .select('telefone, status')
        .eq('id', req.params.id)
        .single();

      if (!c) return fechar('chamada_nao_encontrada');

      let sessao: Awaited<ReturnType<typeof abrirEscuta>> | null = null;

      try {
        sessao = await abrirEscuta(
          c.telefone,
          (quadro) => {
            if (conexao.readyState === 1) conexao.send(quadro);
          },
          req.log,
        );
        conexao.send(JSON.stringify({ pronto: true, formato: 'ulaw', taxa: 8000 }));
      } catch (e) {
        req.log.warn({ e: String(e) }, 'falha ao abrir escuta');
        return fechar('sem_canal_ativo');
      }

      conexao.on('close', () => sessao?.parar());
      conexao.on('error', () => sessao?.parar());
    },
  );
}
