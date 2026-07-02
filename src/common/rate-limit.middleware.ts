import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const VENTANA_MS = 60_000;
const LIMITE_POR_IP = 30; // peticiones por IP por minuto

const contador = new Map<string, { count: number; expira: number }>();

// Limpieza periódica para no acumular memoria indefinidamente
setInterval(() => {
  const ahora = Date.now();
  for (const [ip, entrada] of contador) {
    if (ahora > entrada.expira) contador.delete(ip);
  }
}, VENTANA_MS).unref();

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const ip = req.ip || req.socket?.remoteAddress || 'desconocido';
    const ahora = Date.now();
    const entrada = contador.get(ip);

    if (!entrada || ahora > entrada.expira) {
      contador.set(ip, { count: 1, expira: ahora + VENTANA_MS });
      return next();
    }

    entrada.count++;
    if (entrada.count > LIMITE_POR_IP) {
      throw new HttpException('Demasiadas peticiones, intenta de nuevo en un minuto', HttpStatus.TOO_MANY_REQUESTS);
    }
    next();
  }
}
