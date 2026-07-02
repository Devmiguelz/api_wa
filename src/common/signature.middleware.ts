import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { esFirmaValida } from './signature.util';

@Injectable()
export class SignatureMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const secret = process.env.DAPI_SIGNING_SECRET;
    if (!secret) {
      // Falla cerrado: si no configuraron el secreto en el server, no dejamos pasar nada.
      throw new UnauthorizedException('Servidor mal configurado');
    }

    const timestamp = req.headers['x-dapi-ts'] as string;
    const firma = req.headers['x-dapi-sig'] as string;

    if (!timestamp || !firma) {
      throw new UnauthorizedException('Falta firma de la petición');
    }

    const bodyRaw = (req as any).rawBody ?? '';
    const path = req.originalUrl.split('?')[0];

    if (!esFirmaValida(secret, req.method, path, timestamp, bodyRaw, firma)) {
      throw new UnauthorizedException('Firma inválida o expirada');
    }

    next();
  }
}
