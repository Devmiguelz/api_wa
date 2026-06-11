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

const logger = pino({ level: 'silent' });

// Map<negocioId, { socket, status, qr }>
export const sessions = new Map();
const messageQueue = new Map();

// Callbacks registrados para QR (SSE)
const qrListeners = new Map();

export function onQR(negocioId, callback) {
    qrListeners.set(negocioId, callback);
}

export function removeQRListener(negocioId) {
    qrListeners.delete(negocioId);
}

export function getStatus(negocioId) {
    const s = sessions.get(negocioId);
    if (!s) return 'disconnected';
    return s.status;
}

export function getSessions() {
    const result = {};
    for (const [id, s] of sessions) {
        result[id] = s.status;
    }
    return result;
}

export function encolarMensaje(negocioId, telefono, mensaje) {
    if (!messageQueue.has(negocioId)) messageQueue.set(negocioId, []);
    messageQueue.get(negocioId).push({ telefono, mensaje });
}


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
        version: version
    });

    sessions.set(negocioId, { socket: sock, status: 'connecting', qr: null, reintentos: 0 });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            const session = sessions.get(negocioId);
            if (session) session.qr = qr;
            const cb = qrListeners.get(negocioId);
            if (cb) cb(qr);
        }

        if (connection === 'open') {
            const session = sessions.get(negocioId);
            if (session) {
                session.status = 'open';
                session.qr = null;
            }
            console.log(`[${negocioId}] Conectado`);

            const cola = messageQueue.get(negocioId) ?? [];
            if (cola.length > 0) {
                messageQueue.delete(negocioId);
                console.log(`[${negocioId}] Enviando ${cola.length} mensajes encolados`);
                for (const { telefono, mensaje } of cola) {
                    sendMessage(negocioId, telefono, mensaje).catch(e =>
                        console.error(`[${negocioId}] Error enviando mensaje encolado:`, e.message)
                    );
                }
            }
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = reason !== DisconnectReason.loggedOut;
            const reintentos = (sessions.get(negocioId)?.reintentos ?? 0) + 1;

            console.log(`[${negocioId}] Desconectado. Razón: ${reason}. Reconectar: ${shouldReconnect}`);
            sessions.delete(negocioId);

            // Razón 500 con Bad MAC = sesión corrompida → limpiar y reconectar desde cero
            if (reason === 500) {
                console.log(`[${negocioId}] Sesión corrompida. Limpiando credenciales...`);
                const authDir = path.join(SESSIONS_DIR, negocioId);
                fs.rmSync(authDir, { recursive: true, force: true });
                // No reconectar automáticamente — requiere nuevo QR
                return;
            }

            if (shouldReconnect) {
                if (reintentos > 5) {
                    console.log(`[${negocioId}] Demasiados reintentos. Abortando reconexión.`);
                    sessions.delete(negocioId);
                    return;
                }
                const delay = Math.min(3000 * Math.pow(2, reintentos - 1), 60000); // 3s, 6s, 12s... máx 60s
                console.log(`[${negocioId}] Reintento ${reintentos}/5 en ${delay/1000}s`);
                sessions.set(negocioId, { ...(sessions.get(negocioId) ?? {}), reintentos });
                setTimeout(() => connectSession(negocioId), delay);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

export async function sendMessage(negocioId, telefono, mensaje) {
    const session = sessions.get(negocioId);
    if (!session || session.status !== 'open') {
        throw new Error(`Sesión no disponible para negocio ${negocioId}`);
    }

    // Normalizar número: solo dígitos, agregar @s.whatsapp.net
    let numero = telefono.replace(/\D/g, '');
    if (!numero.startsWith('57')) numero = `57${numero}`;
    const jid = numero.includes('@') ? numero : `${numero}@s.whatsapp.net`;

    await session.socket.sendMessage(jid, { text: mensaje });
}

export async function disconnectSession(negocioId) {
    const session = sessions.get(negocioId);
    if (!session) return;

    // 1. Intentar logout limpio primero
    try {
        await session.socket.logout();
    } catch (_) {}

    // 2. Limpiar estado y archivos después
    sessions.delete(negocioId);
    const authDir = path.join(SESSIONS_DIR, negocioId);
    fs.rmSync(authDir, { recursive: true, force: true });
}
