import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

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

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`WhatsApp service (NestJS) corriendo en :${port}`);
}

bootstrap();
