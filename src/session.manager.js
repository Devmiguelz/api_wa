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
    console.log(`[${negocioId}] connectSession() llamado`);

    const estadoActual = sessions.get(negocioId)?.status;
    if (estadoActual === 'open') {
        console.log(`[${negocioId}] Ya está conectado, saliendo`);
        return;
    }
    console.log(`[${negocioId}] Estado actual: ${estadoActual ?? 'sin sesión'}`);

    const authDir = path.join(SESSIONS_DIR, negocioId);
    const authExiste = fs.existsSync(authDir);
    console.log(`[${negocioId}] Carpeta de credenciales existe: ${authExiste} (${authDir})`);

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    console.log(`[${negocioId}] Credenciales cargadas. registered: ${state.creds?.registered ?? false}`);

    const { version } = await fetchLatestBaileysVersion();
    console.log(`[${negocioId}] Versión Baileys: ${version}`);

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
    console.log(`[${negocioId}] Socket creado, status: connecting`);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        console.log(`[${negocioId}] connection.update → connection: ${connection ?? 'null'}, qr: ${qr ? 'sí' : 'no'}`);

        // ── QR disponible ──
        if (qr) {
            console.log(`[${negocioId}] QR generado, notificando listeners`);
            const session = sessions.get(negocioId);
            if (session) session.qr = qr;
            qrListeners.get(negocioId)?.(qr);
        }

        // ── Sesión abierta ──
        if (connection === 'open') {
            const session = sessions.get(negocioId);
            if (session) { session.status = 'open'; session.qr = null; }
            console.log(`[${negocioId}] Conectado`);

            const cola = messageQueue.get(negocioId) ?? [];
            if (cola.length > 0) {
                messageQueue.delete(negocioId);
                console.log(`[${negocioId}] Enviando ${cola.length} mensajes encolados`);
                for (const { telefono, mensaje } of cola) {
                    sendMessage(negocioId, telefono, mensaje).catch(e =>
                        console.error(`[${negocioId}] Error enviando encolado:`, e.message)
                    );
                }
            } else {
                console.log(`[${negocioId}] Sin mensajes en cola`);
            }
        }

        // ── Sesión cerrada ──
        if (connection === 'close') {
            const reason     = new Boom(lastDisconnect?.error)?.output?.statusCode;
            const errorMsg   = lastDisconnect?.error?.message ?? '';
            const reintentos = (sessions.get(negocioId)?.reintentos ?? 0) + 1;
            const esBadMAC   = errorMsg.includes('Bad MAC') || errorMsg.includes('Failed to decrypt');
            const loggedOut  = reason === DisconnectReason.loggedOut;

            console.log(`[${negocioId}] Conexión cerrada — razón: ${reason}, errorMsg: "${errorMsg}", esBadMAC: ${esBadMAC}, loggedOut: ${loggedOut}`);

            sessions.delete(negocioId);
            console.log(`[${negocioId}] Eliminado de memoria`);

            // Sesión corrompida o Bad MAC → eliminar credenciales, requiere nuevo QR
            if (esBadMAC || reason === 500) {
                console.log(`[${negocioId}] Sesión inválida. Eliminando credenciales del disco.`);
                fs.rmSync(path.join(SESSIONS_DIR, negocioId), { recursive: true, force: true });
                console.log(`[${negocioId}] Credenciales eliminadas. Requiere nuevo QR.`);
                return;
            }

            // Logout explícito → no reconectar
            if (loggedOut) {
                console.log(`[${negocioId}] Sesión cerrada (logout). No se reconecta.`);
                return;
            }

            // Error transitorio → backoff exponencial, máx 5 reintentos
            if (reintentos > 5) {
                console.log(`[${negocioId}] Demasiados reintentos (${reintentos}). Abortando reconexión.`);
                return;
            }

            const delay = Math.min(3000 * Math.pow(2, reintentos - 1), 60000);
            console.log(`[${negocioId}] Reintento ${reintentos}/5 en ${delay / 1000}s`);
            sessions.set(negocioId, { socket: null, status: 'reconnecting', qr: null, reintentos });
            setTimeout(() => connectSession(negocioId), delay);
        }
    });

    sock.ev.on('creds.update', () => {
        console.log(`[${negocioId}] creds.update — guardando credenciales`);
        saveCreds();
    });
}

// ── Envío ─────────────────────────────────────────────────────

export async function sendMessage(negocioId, telefono, mensaje) {
    console.log(`[${negocioId}] sendMessage() → telefono: ${telefono}`);

    const session = sessions.get(negocioId);
    if (!session || session.status !== 'open') {
        console.log(`[${negocioId}] sendMessage() fallido — status: ${session?.status ?? 'sin sesión'}`);
        throw new Error(`Sesión no disponible para negocio ${negocioId}`);
    }

    let numero = telefono.replace(/\D/g, '');
    if (!numero.startsWith('57')) numero = `57${numero}`;
    const jid = numero.includes('@') ? numero : `${numero}@s.whatsapp.net`;

    console.log(`[${negocioId}] Enviando a JID: ${jid}`);
    await session.socket.sendMessage(jid, { text: mensaje });
    console.log(`[${negocioId}] Mensaje enviado OK`);
}

// ── Desconexión limpia ────────────────────────────────────────

export async function disconnectSession(negocioId) {
    console.log(`[${negocioId}] Iniciando desconexión...`);

    const session = sessions.get(negocioId);
    if (!session) {
        console.log(`[${negocioId}] No hay sesión en memoria, nada que hacer`);
        return;
    }

    console.log(`[${negocioId}] Sesión encontrada en memoria. Status: ${session.status}`);

    // 1. Limpiar de memoria PRIMERO — evita que connection.update reconecte
    sessions.delete(negocioId);
    console.log(`[${negocioId}] Eliminado de memoria`);

    // 2. Matar todos los listeners del socket — evita reconexión automática
    try {
        session.socket.ev.removeAllListeners();
        console.log(`[${negocioId}] Listeners removidos`);
    } catch (e) {
        console.log(`[${negocioId}] Error removiendo listeners: ${e.message}`);
    }

    // 3. Limpiar carpeta de sesión en disco
    const authDir = path.join(SESSIONS_DIR, negocioId);
    const existeDir = fs.existsSync(authDir);
    console.log(`[${negocioId}] Carpeta sesión existe en disco: ${existeDir} (${authDir})`);

    if (existeDir) {
        try {
            fs.rmSync(authDir, { recursive: true, force: true });
            console.log(`[${negocioId}] Carpeta eliminada del disco`);
        } catch (e) {
            console.error(`[${negocioId}] Error eliminando carpeta:`, e.message);
        }
    }

    // 4. Intentar logout en WA — best effort con timeout
    console.log(`[${negocioId}] Intentando logout en WhatsApp...`);
    try {
        await Promise.race([
            session.socket.logout(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout 5s')), 5000)
            ),
        ]);
        console.log(`[${negocioId}] Logout de WA exitoso`);
    } catch (e) {
        console.log(`[${negocioId}] Logout de WA omitido: ${e.message}`);
    }

    console.log(`[${negocioId}] Desconexión completa`);
}