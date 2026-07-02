import * as crypto from 'crypto';

/**
 * Esquema de firma "Dapi".
 *
 * Cada petición del front hacia este backend debe venir firmada con
 * HMAC-SHA256 sobre: palabra_del_día : método : ruta : timestamp : cuerpo_crudo
 *
 * La "palabra del día" es solo un giro simpático (rota sola, no hay que
 * coordinarla a mano) pero la protección real viene de:
 *  - el timestamp (la firma expira, no sirve para repetir una petición vieja)
 *  - que el cuerpo forma parte de la firma (si alguien lo modifica, la firma
 *    ya no coincide)
 *
 * IMPORTANTE: si cambian esta lista de palabras o el algoritmo, deben
 * cambiarlo IGUAL en el frontend: app/core/utils/dapi-signature.util.ts
 */
export const DAPI_WORDS = [
  'guayacan', 'carranga', 'mochila', 'totuma', 'changua', 'arepa',
  'bocachico', 'palenque', 'vallenato', 'carnaval', 'patacon', 'tayrona',
  'sancocho', 'guacharaca',
];

const VENTANA_TOLERANCIA_MS = 5 * 60 * 1000; // 5 minutos

export function palabraDelDia(fecha: Date): string {
  const inicioAnio = Date.UTC(fecha.getUTCFullYear(), 0, 0);
  const hoy = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
  const dayOfYear = Math.floor((hoy - inicioAnio) / 86400000);
  return DAPI_WORDS[dayOfYear % DAPI_WORDS.length];
}

export function construirMensaje(
  palabra: string,
  method: string,
  path: string,
  timestamp: string,
  bodyRaw: string,
): string {
  return `${palabra}:${method.toUpperCase()}:${path}:${timestamp}:${bodyRaw}`;
}

export function firmarHex(secret: string, mensaje: string): string {
  return crypto.createHmac('sha256', secret).update(mensaje).digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function esFirmaValida(
  secret: string,
  method: string,
  path: string,
  timestamp: string,
  bodyRaw: string,
  firmaRecibida: string,
): boolean {
  const ts = Number(timestamp);
  if (!ts || !Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() - ts) > VENTANA_TOLERANCIA_MS) return false; // evita "replay"

  const ahora = new Date();
  const ayer = new Date(ahora.getTime() - 86400000);
  // Tolerancia al cruce de medianoche: probamos la palabra de hoy y la de ayer
  const candidatas = [palabraDelDia(ahora), palabraDelDia(ayer)];

  return candidatas.some((palabra) => {
    const esperada = firmarHex(secret, construirMensaje(palabra, method, path, timestamp, bodyRaw));
    return timingSafeEqualHex(esperada, firmaRecibida);
  });
}
