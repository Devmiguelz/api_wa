import { Injectable, Logger } from '@nestjs/common';
import { COUNTRY_CODE, META_TEMPLATE_NAME, META_TEMPLATE_LANG } from '../config/constants';

@Injectable()
export class MetaService {
  private readonly log = new Logger(MetaService.name);

  async sendMessageMeta(telefono: string, negocioNombre: string, estadoPedido: string) {
    const url = `https://graph.facebook.com/v20.0/${process.env.META_PHONE_ID}/messages`;

    let numero = telefono.replace(/\D/g, '');
    if (!numero.startsWith(COUNTRY_CODE)) numero = `${COUNTRY_CODE}${numero}`;

    const body = {
      messaging_product: 'whatsapp',
      to: numero,
      type: 'template',
      template: {
        name: META_TEMPLATE_NAME,
        language: { code: META_TEMPLATE_LANG },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: negocioNombre },
              { type: 'text', text: estadoPedido },
            ],
          },
        ],
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.META_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(JSON.stringify(error));
    }

    return res.json();
  }
}
