import { Module } from '@nestjs/common';
import { MetaService } from './meta.service';
import { MetaController } from './meta.controller';

@Module({
  providers: [MetaService],
  controllers: [MetaController],
})
export class MetaModule {}
