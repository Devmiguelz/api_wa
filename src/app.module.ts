import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { MetaModule } from './meta/meta.module';
import { AiModule } from './ai/ai.module';
import { VisionModule } from './vision/vision.module';
import { SignatureMiddleware } from './common/signature.middleware';
import { RateLimitMiddleware } from './common/rate-limit.middleware';

@Module({
  imports: [WhatsappModule, MetaModule, AiModule, VisionModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Rate limiting aplica a todo, incluido /health
    consumer.apply(RateLimitMiddleware).forRoutes('*');

    // La firma se exige a todo menos al health check (para monitores externos)
    consumer.apply(SignatureMiddleware).exclude('health').forRoutes('*');
  }
}
