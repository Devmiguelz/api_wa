import { Controller, Post, Body, Res, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { MetaService } from './meta.service';

class SendMetaDto {
  telefono: string;
  negocioNombre: string;
  estadoPedido: string;
}

@Controller('messages')
export class MetaController {
  private readonly log = new Logger(MetaController.name);

  constructor(private readonly metaService: MetaService) {}

  // POST /messages/send-meta
  @Post('send-meta')
  async sendMeta(@Body() dto: SendMetaDto, @Res() res: Response) {
    const { telefono, negocioNombre, estadoPedido } = dto;

    if (!telefono || !negocioNombre || !estadoPedido) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: 'telefono, negocioNombre y estadoPedido son requeridos',
      });
    }

    try {
      const resultado = await this.metaService.sendMessageMeta(telefono, negocioNombre, estadoPedido);
      return res.json({ success: true, meta: resultado });
    } catch (err: any) {
      this.log.error(`[send-meta] ${err.message}`);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: err.message });
    }
  }
}
