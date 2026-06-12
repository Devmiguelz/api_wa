import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(__dirname, '..', 'sessions');

// ── Suprimir logs de Bad MAC que Baileys imprime con console.error directo ──
const _consoleError = console.error.bind(console);
console.error = (...args) => {
    const texto = args.map(a => String(a ?? '')).join(' ');
    if (
        texto.includes('Bad MAC') ||
        texto.includes('Failed to decrypt') ||
        texto.includes('Session error')
    ) return;
    _consoleError(...args);
};

// ── Suprimir también los que llegan como promesas rechazadas ──
process.on('unhandledRejection', (reason) => {
    const msg = reason?.message ?? String(reason ?? '');
    if (msg.includes('Bad MAC') || msg.includes('Failed to decrypt')) return;
    console.error('[unhandledRejection]', reason);
});

// ── Logger de pino completamente silencioso para Baileys ──
const logger = pino({ level: 'silent' });

// Map<negocioId, { socket, status, qr, reintentos }>
export const sessions = new Map();
const messageQueue = new Map();
const qrListeners  = new Map();

// ── Helpers de estado ────────────────────────────────────────

export function onQR(negocioId, callback) {
    qrListeners.set(negocioId, callback);
}

export function removeQRListener(negocioId) {
    qrListeners.delete(negocioId);
}

export function getStatus(negocioId) {
    return sessions.get(negocioId)?.status ?? 'disconnected';
}

export function getSessions() {
    const result = {};
    for (const [id, s] of sessions) result[id] = s.status;
    return result;
}

export function encolarMensaje(negocioId, telefono, mensaje) {
    if (!messageQueue.has(negocioId)) messageQueue.set(negocioId, []);
    messageQueue.get(negocioId).push({ telefono, mensaje });
    console.log(`[${negocioId}] Mensaje encolado (cola: ${messageQueue.get(negocioId).length})`);
}

// ── Conexión ─────────────────────────────────────────────────

export async function connectSession(negocioId) {
    if (sessions.get(negocioId)?.status === 'open') return;

    const authDir = path.join(SESSIONS_DIR, negocioId);
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

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

    sessions.set(negocioId, { socket: sock, status: 'connecting', qr: null, reintentos: 0 });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // ── QR disponible ──
        if (qr) {
            const session = sessions.get(negocioId);
            if (session) session.qr = qr;
            qrListeners.get(negocioId)?.(qr);
        }

        // ── Sesión abierta ──
        if (connection === 'open') {
            const session = sessions.get(negocioId);
            if (session) { session.status = 'open'; session.qr = null; }
            console.log(`[${negocioId}] Conectado`);

            // Vaciar cola de mensajes pendientes
            const cola = messageQueue.get(negocioId) ?? [];
            if (cola.length > 0) {
                messageQueue.delete(negocioId);
                console.log(`[${negocioId}] Enviando ${cola.length} mensajes encolados`);
                for (const { telefono, mensaje } of cola) {
                    sendMessage(negocioId, telefono, mensaje).catch(e =>
                        console.error(`[${negocioId}] Error enviando encolado:`, e.message)
                    );
                }
            }
        }

        // ── Sesión cerrada ──
        if (connection === 'close') {
            const reason      = new Boom(lastDisconnect?.error)?.output?.statusCode;
            const errorMsg    = lastDisconnect?.error?.message ?? '';
            const reintentos  = (sessions.get(negocioId)?.reintentos ?? 0) + 1;
            const esBadMAC    = errorMsg.includes('Bad MAC') || errorMsg.includes('Failed to decrypt');
            const loggedOut   = reason === DisconnectReason.loggedOut;

            sessions.delete(negocioId);

            // Sesión corrompida o Bad MAC → eliminar credenciales, requiere nuevo QR
            if (esBadMAC || reason === 500) {
                console.log(`[${negocioId}] Sesión inválida. Eliminando credenciales.`);
                fs.rmSync(path.join(SESSIONS_DIR, negocioId), { recursive: true, force: true });
                return;
            }

            // Logout explícito → no reconectar
            if (loggedOut) {
                console.log(`[${negocioId}] Sesión cerrada (logout).`);
                return;
            }

            // Error transitorio → backoff exponencial, máx 5 reintentos
            if (reintentos > 5) {
                console.log(`[${negocioId}] Demasiados reintentos. Abortando.`);
                return;
            }

            const delay = Math.min(3000 * Math.pow(2, reintentos - 1), 60000);
            console.log(`[${negocioId}] Reintento ${reintentos}/5 en ${delay / 1000}s`);
            sessions.set(negocioId, { socket: null, status: 'reconnecting', qr: null, reintentos });
            setTimeout(() => connectSession(negocioId), delay);
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// ── Envío ─────────────────────────────────────────────────────

export async function sendMessage(negocioId, telefono, mensaje) {
    const session = sessions.get(negocioId);
    if (!session || session.status !== 'open') {
        throw new Error(`Sesión no disponible para negocio ${negocioId}`);
    }

    let numero = telefono.replace(/\D/g, '');
    if (!numero.startsWith('57')) numero = `57${numero}`;
    const jid = numero.includes('@') ? numero : `${numero}@s.whatsapp.net`;

    await session.socket.sendMessage(jid, { text: mensaje });
}

// ── Desconexión limpia ────────────────────────────────────────

export async function disconnectSession(negocioId) {
    const session = sessions.get(negocioId);
    if (!session) return;

    try { await session.socket.logout(); } catch (_) {}

    sessions.delete(negocioId);
    fs.rmSync(path.join(SESSIONS_DIR, negocioId), { recursive: true, force: true });
}