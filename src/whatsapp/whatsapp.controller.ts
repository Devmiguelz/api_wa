import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Res,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import * as QRCode from 'qrcode';
import { SessionService } from './session.service';

// ── DTOs ─────────────────────────────────────────────────────

class SendMessageDto {
  negocioId: string;
  telefono: string;
  mensaje: string;
}

class CheckWhatsappDto {
  telefono: string;
}

// ── Controller ───────────────────────────────────────────────

@Controller()
export class WhatsappController {
  private readonly log = new Logger(WhatsappController.name);

  constructor(private readonly sessionService: SessionService) {}

  // GET /health
  @Get('health')
  health() {
    const all = this.sessionService.getSessions();
    const open = Object.values(all).filter((s) => s === 'open').length;
    return { ok: true, sesiones: { total: Object.keys(all).length, activas: open } };
  }

  // GET /sessions
  @Get('sessions')
  getSessions() {
    return this.sessionService.getSessions();
  }

  // GET /sessions/:negocioId/status
  @Get('sessions/:negocioId/status')
  getStatus(@Param('negocioId') negocioId: string) {
    return { negocioId, status: this.sessionService.getStatus(negocioId) };
  }

  // POST /sessions/:negocioId/connect
  @Post('sessions/:negocioId/connect')
  async connect(@Param('negocioId') negocioId: string, @Res() res: Response) {
    if (this.sessionService.getStatus(negocioId) === 'open') {
      return res.json({ status: 'already_connected' });
    }

    const qrPromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.sessionService.removeQRListener(negocioId);
        reject(new Error('Timeout esperando QR'));
      }, 30000);

      this.sessionService.onQR(negocioId, async (qr) => {
        clearTimeout(timeout);
        this.sessionService.removeQRListener(negocioId);
        try {
          const qrBase64 = await QRCode.toDataURL(qr);
          resolve(qrBase64);
        } catch (e) {
          reject(e);
        }
      });
    });

    this.sessionService.connectSession(negocioId).catch(console.error);

    try {
      const qrBase64 = await qrPromise;
      return res.json({ status: 'qr_ready', qr: qrBase64 });
    } catch (err: any) {
      return res.status(HttpStatus.REQUEST_TIMEOUT).json({ error: err.message });
    }
  }

  // DELETE /sessions/:negocioId
  @Delete('sessions/:negocioId')
  async disconnect(@Param('negocioId') negocioId: string, @Res() res: Response) {
    try {
      await this.sessionService.disconnectSession(negocioId);
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: err.message });
    }
  }

  // POST /messages/send
  @Post('messages/send')
  async sendMessage(@Body() dto: SendMessageDto, @Res() res: Response) {
    const { negocioId, telefono, mensaje } = dto;

    if (!negocioId || !telefono || !mensaje) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: 'negocioId, telefono y mensaje son requeridos',
      });
    }

    const session = this.sessionService.getSessionSocket(negocioId);

    if (session?.status === 'connecting') {
      this.sessionService.encolarMensaje(negocioId, telefono, mensaje);
      return res.json({ success: true, queued: true });
    }

    if (!session || session.status !== 'open') {
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        error: `Sesión no disponible para negocio ${negocioId}`,
      });
    }

    try {
      await this.sessionService.sendMessage(negocioId, telefono, mensaje);
      return res.json({ success: true, queued: false });
    } catch (err: any) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: err.message });
    }
  }

  // POST /check-whatsapp
  @Post('check-whatsapp')
  async checkWhatsapp(@Body() dto: CheckWhatsappDto, @Res() res: Response) {
    if (!dto.telefono) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: 'telefono requerido' });
    }
    try {
      const result = await this.sessionService.checkWhatsapp(dto.telefono);
      return res.json(result);
    } catch (e: any) {
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ error: e.message, exists: null });
    }
  }
}
