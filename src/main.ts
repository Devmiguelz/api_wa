import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import { AppModule } from './app.module';

process.on('unhandledRejection', (reason: any) => {
  const msg = reason?.message ?? String(reason ?? '');
  if (msg.includes('Bad MAC') || msg.includes('Failed to decrypt')) return;
  console.error('[unhandledRejection]', reason);
});

async function bootstrap() {
  // bodyParser: false porque necesitamos capturar el cuerpo crudo (rawBody)
  // exacto que envió el cliente, para poder verificar su firma HMAC.
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn'],
    bodyParser: false,
  });

  app.use(
    json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
  );

  const allowedOrigins = (process.env.ALLOWED_ORIGIN || '').split(',').map(o => o.trim());

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'x-dapi-ts', 'x-dapi-sig'],
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  const missing = ['META_TOKEN', 'META_PHONE_ID', 'DAPI_SIGNING_SECRET', 'GOOGLE_VISION_API_KEY', 'OPENAI_API_KEY']
    .filter(k => !process.env[k]);
  if (missing.length) {
    console.warn(`[config] Variables de entorno no definidas: ${missing.join(', ')}`);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`WhatsApp service (NestJS) corriendo en :${port}`);
}

bootstrap();
