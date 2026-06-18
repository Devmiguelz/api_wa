import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from './routes.js';
import { connectSession, getSessions } from './session.manager.js';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(__dirname, '..', 'sessions');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'dev-key';

// ── Middlewares ──────────────────────────────────────────

app.use(express.json());

// CORS simple — ajusta el origin a tu dominio en producción
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || '').split(',').map(o => o.trim());

app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// Auth por API key
app.use((req, res, next) => {
    if (req.headers['x-api-key'] !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
});

// ── Rutas ────────────────────────────────────────────────

app.use('/', routes);

app.get('/health', (req, res) => {
    const all = getSessions();
    const open = Object.values(all).filter(s => s === 'open').length;
    res.json({
        ok: true,
        sesiones: { total: Object.keys(all).length, activas: open },
    });
});

// ── Inicio ───────────────────────────────────────────────

// Al arrancar, reconecta automáticamente los negocios que ya tenían sesión guardada
async function reconectarSesionesGuardadas() {
    if (!fs.existsSync(SESSIONS_DIR)) {
        fs.mkdirSync(SESSIONS_DIR, { recursive: true });
        return;
    }
    const negocios = fs.readdirSync(SESSIONS_DIR);
    for (const negocioId of negocios) {
        console.log(`[boot] Reconectando sesión: ${negocioId}`);
        try {
            await connectSession(negocioId);
            // Pausa entre conexiones para no saturar WA
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
            console.error(`[boot] Error reconectando ${negocioId}:`, e.message);
        }
    }
}

app.listen(PORT, () => {
    console.log(`WhatsApp service corriendo en :${PORT}`);
    reconectarSesionesGuardadas();
});

process.on('SIGTERM', () => {
    console.log('[shutdown] SIGTERM recibido, cerrando...');
    process.exit(0);
});
