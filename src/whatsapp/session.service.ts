import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import makeWASocket, {
  WASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';
import { COUNTRY_CODE, SUPERADMIN_SESSION_ID } from '../config/constants';

const logger = pino({ level: 'silent' });

interface SessionData {
  socket: WASocket | null;
  status: 'connecting' | 'open' | 'disconnected' | 'reconnecting';
  qr: string | null;
  reintentos: number;
}

@Injectable()
export class SessionService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SessionService.name);
  private readonly SESSIONS_DIR = path.join(process.cwd(), 'sessions');
  private readonly sessions = new Map<string, SessionData>();
  private readonly messageQueue = new Map<string, { telefono: string; mensaje: string }[]>();
  private readonly qrListeners = new Map<string, (qr: string) => void>();
  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>();

  async onModuleInit() {
    if (!fs.existsSync(this.SESSIONS_DIR)) {
      fs.mkdirSync(this.SESSIONS_DIR, { recursive: true });
      return;
    }
    const negocios = fs.readdirSync(this.SESSIONS_DIR);
    for (const negocioId of negocios) {
      this.log.log(`[boot] Reconectando sesión: ${negocioId}`);
      try {
        await this.connectSession(negocioId);
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e: any) {
        this.log.error(`[boot] Error reconectando ${negocioId}: ${e.message}`);
      }
    }
  }

  async onModuleDestroy() {
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
  }

  onQR(negocioId: string, callback: (qr: string) => void) {
    this.qrListeners.set(negocioId, callback);
  }

  removeQRListener(negocioId: string) {
    this.qrListeners.delete(negocioId);
  }

  getStatus(negocioId: string): string {
    return this.sessions.get(negocioId)?.status ?? 'disconnected';
  }

  getSessions(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [id, s] of this.sessions) result[id] = s.status;
    return result;
  }

  encolarMensaje(negocioId: string, telefono: string, mensaje: string) {
    if (!this.messageQueue.has(negocioId)) this.messageQueue.set(negocioId, []);
    this.messageQueue.get(negocioId)!.push({ telefono, mensaje });
    this.log.log(`[${negocioId}] Mensaje encolado (cola: ${this.messageQueue.get(negocioId)!.length})`);
  }

  getSessionSocket(negocioId: string) {
    return this.sessions.get(negocioId);
  }

  async connectSession(negocioId: string) {
    this.log.log(`[${negocioId}] connectSession() llamado`);

    if (this.sessions.get(negocioId)?.status === 'open') {
      this.log.log(`[${negocioId}] Ya está conectado, saliendo`);
      return;
    }

    const authDir = path.join(this.SESSIONS_DIR, negocioId);
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const { version } = await fetchLatestBaileysVersion().catch(() => ({
      version: [2, 3000, 1023498150] as [number, number, number],
    }));

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      version,
    });

    this.sessions.set(negocioId, { socket: sock, status: 'connecting', qr: null, reintentos: 0 });

    sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const session = this.sessions.get(negocioId);
        if (session) session.qr = qr;
        this.qrListeners.get(negocioId)?.(qr);
      }

      if (connection === 'open') {
        const session = this.sessions.get(negocioId);
        if (session) { session.status = 'open'; session.qr = null; }
        this.log.log(`[${negocioId}] Conectado`);

        const cola = this.messageQueue.get(negocioId) ?? [];
        if (cola.length > 0) {
          this.messageQueue.delete(negocioId);
          for (const { telefono, mensaje } of cola) {
            this.sendMessage(negocioId, telefono, mensaje).catch((e: any) =>
              this.log.error(`[${negocioId}] Error enviando encolado: ${e.message}`),
            );
          }
        }
      }

      if (connection === 'close') {
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const errorMsg = lastDisconnect?.error?.message ?? '';
        const reintentos = (this.sessions.get(negocioId)?.reintentos ?? 0) + 1;
        const esBadMAC = errorMsg.includes('Bad MAC') || errorMsg.includes('Failed to decrypt');
        const loggedOut = reason === DisconnectReason.loggedOut;

        this.log.warn(`[${negocioId}] Conexión cerrada — razón: ${reason}`);
        this.sessions.delete(negocioId);

        if (esBadMAC || reason === 500) {
          this.log.warn(`[${negocioId}] Sesión inválida. Eliminando credenciales.`);
          fs.rmSync(path.join(this.SESSIONS_DIR, negocioId), { recursive: true, force: true });
          return;
        }

        if (loggedOut) {
          this.log.log(`[${negocioId}] Logout. No se reconecta.`);
          return;
        }

        if (reintentos > 5) {
          this.log.warn(`[${negocioId}] Demasiados reintentos. Abortando.`);
          return;
        }

        const delay = Math.min(3000 * Math.pow(2, reintentos - 1), 60000);
        this.log.log(`[${negocioId}] Reintento ${reintentos}/5 en ${delay / 1000}s`);
        this.sessions.set(negocioId, { socket: null, status: 'reconnecting', qr: null, reintentos });

        const timer = setTimeout(() => {
          this.reconnectTimers.delete(negocioId);
          this.connectSession(negocioId);
        }, delay);
        this.reconnectTimers.set(negocioId, timer);
      }
    });

    sock.ev.on('creds.update', saveCreds);
  }

  async sendMessage(negocioId: string, telefono: string, mensaje: string) {
    const session = this.sessions.get(negocioId);
    if (!session || session.status !== 'open') {
      throw new Error(`Sesión no disponible para negocio ${negocioId}`);
    }

    let numero = telefono.replace(/\D/g, '');
    if (!numero.startsWith(COUNTRY_CODE)) numero = `${COUNTRY_CODE}${numero}`;
    const jid = numero.includes('@') ? numero : `${numero}@s.whatsapp.net`;

    await session.socket!.sendMessage(jid, { text: mensaje });
    this.log.log(`[${negocioId}] Mensaje enviado a ${jid}`);
  }

  async disconnectSession(negocioId: string) {
    const session = this.sessions.get(negocioId);
    if (!session) return;

    const timer = this.reconnectTimers.get(negocioId);
    if (timer) { clearTimeout(timer); this.reconnectTimers.delete(negocioId); }

    this.sessions.delete(negocioId);

    try { (session.socket?.ev as any)?.removeAllListeners?.(); } catch (_) {}

    const authDir = path.join(this.SESSIONS_DIR, negocioId);
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
    }

    try {
      await Promise.race([
        session.socket?.logout() ?? Promise.resolve(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]);
    } catch (_) {}

    this.log.log(`[${negocioId}] Desconexión completa`);
  }

  async checkWhatsapp(telefono: string): Promise<{ exists: boolean; jid: string | null }> {
    const session = this.sessions.get(SUPERADMIN_SESSION_ID);

    if (!session || session.status !== 'open') {
      throw new Error('Sesión superadmin no disponible');
    }

    let numero = telefono.replace(/\D/g, '');
    if (!numero.startsWith(COUNTRY_CODE)) numero = `${COUNTRY_CODE}${numero}`;

    const [result] = await session.socket!.onWhatsApp(numero);
    return { exists: !!result?.exists, jid: (result?.jid as string) ?? null };
  }
}
