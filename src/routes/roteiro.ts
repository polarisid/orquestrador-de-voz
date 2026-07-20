import type { FastifyInstance } from 'fastify';
import { montarPrompt } from '../agent/prompt.js';

/**
 * Monta o roteiro a partir dos dados da OS, para o operador ler e ajustar
 * antes de discar. O que ele salvar aqui é o que o agente recebe.
 */
export async function rotasRoteiro(app: FastifyInstance) {
  app.post<{
    Body: {
      os_numero?: string;
      cliente_nome?: string;
      cliente_endereco?: string;
      produto_modelo?: string;
      produto_linha?: string;
      sintoma_declarado?: string;
      garantia?: 'em_garantia' | 'fora_garantia' | 'a_confirmar';
    };
  }>('/roteiro/preview', async (req) => {
    const b = req.body ?? {};
    return {
      roteiro: montarPrompt({
        os: b.os_numero || '(número da OS)',
        clienteNome: b.cliente_nome || '(nome do cliente)',
        clienteEndereco: b.cliente_endereco || '(endereço)',
        produtoModelo: b.produto_modelo || '(modelo)',
        produtoLinha: b.produto_linha || '(linha)',
        sintomaDeclarado: b.sintoma_declarado || '(sintoma da abertura)',
        garantia: b.garantia ?? 'a_confirmar',
      }),
    };
  });
}
