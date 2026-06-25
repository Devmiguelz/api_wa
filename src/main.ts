import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

process.on('unhandledRejection', (reason: any) => {
  const msg = reason?.message ?? String(reason ?? '');
  if (msg.includes('Bad MAC') || msg.includes('Failed to decrypt')) return;
  console.error('[unhandledRejection]', reason);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'error', 'warn'] });

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
    allowedHeaders: ['Content-Type', 'x-api-key'],
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  const missing = ['META_TOKEN', 'META_PHONE_ID'].filter(k => !process.env[k]);
  if (missing.length) {
    console.warn(`[config] Variables de entorno no definidas: ${missing.join(', ')}`);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`WhatsApp service (NestJS) corriendo en :${port}`);
}

bootstrap();
