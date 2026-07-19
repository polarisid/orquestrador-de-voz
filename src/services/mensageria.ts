/**
 * SMS via API da iFalei (plataforma de SMS do grupo Zievo).
 * WhatsApp exige provedor separado (Meta Cloud API ou BSP) — o template
 * precisa estar aprovado antes de ir para produção.
 */
export const mensageria = {
  async enviar(p: { canal: 'whatsapp' | 'sms'; telefone: string; texto: string }) {
    if (process.env.DRY_RUN === 'true') {
      console.log(`[DRY_RUN] ${p.canal} -> ${p.telefone}: ${p.texto}`);
      return;
    }

    if (p.canal === 'sms') {
      const r = await fetch(`${process.env.IFALEI_API_URL}/sms/enviar`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.IFALEI_TOKEN}`,
        },
        body: JSON.stringify({
          usuario_id_origem: process.env.IFALEI_USUARIO_ID_ORIGEM,
          numero: p.telefone,
          mensagem: p.texto,
        }),
      });
      if (!r.ok) throw new Error(`sms: ${r.status}`);
      return;
    }

    const r = await fetch(`${process.env.WHATSAPP_API_URL}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: `55${p.telefone}`,
        type: 'template',
        template: {
          name: process.env.WHATSAPP_TEMPLATE_DOCS,
          language: { code: 'pt_BR' },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: p.texto }] },
          ],
        },
      }),
    });
    if (!r.ok) throw new Error(`whatsapp: ${r.status}`);
  },
};
