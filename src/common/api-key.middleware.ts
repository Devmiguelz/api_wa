import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class ApiKeyMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const apiKey = process.env.API_KEY || 'dev-key';
    if (req.headers['x-api-key'] !== apiKey) {
      throw new UnauthorizedException('Unauthorized');
    }
    next();
  }
}
