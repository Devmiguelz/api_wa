import { Controller, Post, Body, Logger } from '@nestjs/common';
import { IsString, IsNotEmpty } from 'class-validator';
import { MetaService } from './meta.service';

class SendMetaDto {
  @IsString() @IsNotEmpty() telefono: string;
  @IsString() @IsNotEmpty() negocioNombre: string;
  @IsString() @IsNotEmpty() estadoPedido: string;
}

@Controller('messages')
export class MetaController {
  private readonly log = new Logger(MetaController.name);

  constructor(private readonly metaService: MetaService) {}

  @Post('send-meta')
  async sendMeta(@Body() dto: SendMetaDto) {
    const resultado = await this.metaService.sendMessageMeta(dto.telefono, dto.negocioNombre, dto.estadoPedido);
    return { success: true, meta: resultado };
  }
}
