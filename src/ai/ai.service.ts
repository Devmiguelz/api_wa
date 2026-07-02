import { Injectable, InternalServerErrorException } from '@nestjs/common';

interface IResumenCierreInput {
  totalVentas: number;
  totalPedidos: number;
  porTipo: { label: string; count: number; total: number }[];
  desglose: { metodo: string; count: number; total: number }[];
  efectivoSistema: number;
  diferencia: number | null;
  cajeroNombre: string;
}

interface IDescripcionProductoInput {
  nombre: string;
  categoria: string;
  precio: number;
}

@Injectable()
export class AiService {
  private get apiKey(): string {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new InternalServerErrorException('GEMINI_API_KEY no configurada en el servidor');
    return key;
  }

  private get endpoint(): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.apiKey}`;
  }

  async resumirCierre(datos: IResumenCierreInput): Promise<string> {
    const porTipoTexto = datos.porTipo.length
      ? datos.porTipo.map((t) => `${t.label}: ${t.count} pedido(s) por $${t.total.toLocaleString('es-CO')}`).join(', ')
      : 'sin ventas por canal';

    const desgloseTexto = datos.desglose.length
      ? datos.desglose.map((d) => `${d.metodo}: ${d.count} pago(s) por $${d.total.toLocaleString('es-CO')}`).join(', ')
      : 'sin cobros registrados';

    const diferenciaTexto = datos.diferencia !== null
      ? `La diferencia de caja fue de $${Math.abs(datos.diferencia).toLocaleString('es-CO')} ${datos.diferencia >= 0 ? 'sobrante' : 'faltante'}.`
      : '';

    const prompt = `Eres el asistente del cajero de un restaurante. Escribe un resumen del turno de trabajo de ${datos.cajeroNombre} de forma amigable, cálida y concisa (máximo 3 oraciones). Usa un tono positivo. No uses listas ni bullets.

Datos del turno:
- Total vendido: $${datos.totalVentas.toLocaleString('es-CO')}
- Pedidos completados: ${datos.totalPedidos}
- Por canal: ${porTipoTexto}
- Métodos de pago: ${desgloseTexto}
- Efectivo en sistema: $${datos.efectivoSistema.toLocaleString('es-CO')}
${diferenciaTexto}

Responde solo con el resumen, sin encabezados ni saludos.`;

    return this.llamarGemini(prompt);
  }

  async generarDescripcionProducto(datos: IDescripcionProductoInput): Promise<string> {
    const prompt = `Eres un experto en marketing de restaurantes. Escribe una descripción atractiva y apetitosa para este producto (máximo 2 oraciones, sin precio, sin emojis).

Producto: ${datos.nombre}
Categoría: ${datos.categoria}
Precio: $${datos.precio.toLocaleString('es-CO')}

Responde solo con la descripción, sin comillas ni encabezados.`;

    return this.llamarGemini(prompt);
  }

  private async llamarGemini(prompt: string): Promise<string> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 256 },
      }),
    });

    if (!response.ok) throw new InternalServerErrorException(`Gemini error ${response.status}`);

    const json = await response.json();
    const texto = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return texto.trim();
  }
}
