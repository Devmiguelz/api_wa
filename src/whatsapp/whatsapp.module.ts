import { Module } from '@nestjs/common';
import { SessionService } from './session.service';
import { WhatsappController } from './whatsapp.controller';

@Module({
  providers: [SessionService],
  controllers: [WhatsappController],
  exports: [SessionService],
})
export class WhatsappModule {}
