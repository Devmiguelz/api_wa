import 'dotenv/config';

export async function sendMessageMeta(telefono, negocioNombre, estadoPedido) {
    const url = `https://graph.facebook.com/v20.0/${process.env.META_PHONE_ID}/messages`;

    let numero = telefono.replace(/\D/g, '');
    if (!numero.startsWith('57')) numero = `57${numero}`;

    const body = {
        messaging_product: 'whatsapp',
        to: numero,
        type: 'template',
        template: {
            name: 'dapi_notificacion_pedido',
            language: { code: 'es_CO' },
            components: [{
                type: 'body',
                parameters: [
                    { type: 'text', text: negocioNombre },
                    { type: 'text', text: estadoPedido }
                ]
            }]
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.META_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const error = await res.json();
        throw new Error(JSON.stringify(error));
    }

    return res.json();
}