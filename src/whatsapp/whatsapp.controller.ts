import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Logger,
  RequestTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IsString, IsNotEmpty } from 'class-validator';
import * as QRCode from 'qrcode';
import { SessionService } from './session.service';

class SendMessageDto {
  @IsString() @IsNotEmpty() negocioId: string;
  @IsString() @IsNotEmpty() telefono: string;
  @IsString() @IsNotEmpty() mensaje: string;
}

class CheckWhatsappDto {
  @IsString() @IsNotEmpty() telefono: string;
}

@Controller()
export class WhatsappController {
  private readonly log = new Logger(WhatsappController.name);

  constructor(private readonly sessionService: SessionService) {}

  @Get('health')
  health() {
    const all = this.sessionService.getSessions();
    const open = Object.values(all).filter((s) => s === 'open').length;
    return { ok: true, sesiones: { total: Object.keys(all).length, activas: open } };
  }

  @Get('sessions')
  getSessions() {
    return this.sessionService.getSessions();
  }

  @Get('sessions/:negocioId/status')
  getStatus(@Param('negocioId') negocioId: string) {
    return { negocioId, status: this.sessionService.getStatus(negocioId) };
  }

  @Post('sessions/:negocioId/connect')
  async connect(@Param('negocioId') negocioId: string) {
    if (this.sessionService.getStatus(negocioId) === 'open') {
      return { status: 'already_connected' };
    }

    const qrPromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.sessionService.removeQRListener(negocioId);
        reject(new RequestTimeoutException('Timeout esperando QR'));
      }, 30000);

      this.sessionService.onQR(negocioId, async (qrRaw) => {
        clearTimeout(timeout);
        this.sessionService.removeQRListener(negocioId);
        try {
          resolve(await QRCode.toDataURL(qrRaw));
        } catch (e) {
          reject(e);
        }
      });
    });

    this.sessionService.connectSession(negocioId).catch(console.error);

    const qr = await qrPromise;
    return { status: 'qr_ready', qr };
  }

  @Delete('sessions/:negocioId')
  async disconnect(@Param('negocioId') negocioId: string) {
    await this.sessionService.disconnectSession(negocioId);
    return { success: true };
  }

  @Post('messages/send')
  async sendMessage(@Body() dto: SendMessageDto) {
    const { negocioId, telefono, mensaje } = dto;
    const session = this.sessionService.getSessionSocket(negocioId);

    if (session?.status === 'connecting') {
      this.sessionService.encolarMensaje(negocioId, telefono, mensaje);
      return { success: true, queued: true };
    }

    if (!session || session.status !== 'open') {
      throw new ServiceUnavailableException(`Sesión no disponible para negocio ${negocioId}`);
    }

    await this.sessionService.sendMessage(negocioId, telefono, mensaje);
    return { success: true, queued: false };
  }

  @Post('check-whatsapp')
  async checkWhatsapp(@Body() dto: CheckWhatsappDto) {
    try {
      return await this.sessionService.checkWhatsapp(dto.telefono);
    } catch (e: any) {
      throw new ServiceUnavailableException(e.message);
    }
  }
}
