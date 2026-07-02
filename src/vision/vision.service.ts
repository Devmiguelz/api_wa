import { Injectable, InternalServerErrorException } from '@nestjs/common';

@Injectable()
export class VisionService {
  private get apiKey(): string {
    const key = process.env.GOOGLE_VISION_API_KEY;
    if (!key) throw new InternalServerErrorException('GOOGLE_VISION_API_KEY no configurada en el servidor');
    return key;
  }

  async extraerTexto(base64: string, mimeType: string): Promise<string> {
    const url = `https://vision.googleapis.com/v1/images:annotate?key=${this.apiKey}`;

    const body = {
      requests: [{
        image: { content: base64 },
        features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
        imageContext: { languageHints: ['es'] },
      }],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new InternalServerErrorException(`Google Vision error ${res.status}`);

    const json = await res.json();
    const texto = json?.responses?.[0]?.fullTextAnnotation?.text ?? '';
    if (!texto) throw new InternalServerErrorException('Google Vision no detectó texto en la imagen');
    return texto;
  }
}
