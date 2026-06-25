import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { MetaModule } from './meta/meta.module';
import { ApiKeyMiddleware } from './common/api-key.middleware';

@Module({
  imports: [WhatsappModule, MetaModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ApiKeyMiddleware).forRoutes('*');
  }
}
