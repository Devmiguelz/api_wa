import { Router } from 'express';
import QRCode from 'qrcode';
import {
    connectSession,
    disconnectSession,
    getStatus,
    getSessions,
    sendMessage,
    onQR,
    removeQRListener,
    sessions,
    encolarMensaje
} from './session.manager.js';

const router = Router();

// ── Sesiones ────────────────────────────────────────────

// GET /sessions — lista todos los negocios y su estado
router.get('/sessions', (req, res) => {
    res.json(getSessions());
});

// GET /sessions/:negocioId/status
router.get('/sessions/:negocioId/status', (req, res) => {
    const status = getStatus(req.params.negocioId);
    res.json({ negocioId: req.params.negocioId, status });
});

// POST /sessions/:negocioId/connect — inicia sesión y devuelve QR como imagen base64
router.post('/sessions/:negocioId/connect', async (req, res) => {
    const { negocioId } = req.params;

    if (getStatus(negocioId) === 'open') {
        return res.json({ status: 'already_connected' });
    }

    // Espera el QR con timeout de 30s
    const qrPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            removeQRListener(negocioId);
            reject(new Error('Timeout esperando QR'));
        }, 30000);

        onQR(negocioId, async (qr) => {
            clearTimeout(timeout);
            removeQRListener(negocioId);
            try {
                const qrBase64 = await QRCode.toDataURL(qr);
                resolve(qrBase64);
            } catch (e) {
                reject(e);
            }
        });
    });

    // Inicia la conexión en paralelo
    connectSession(negocioId).catch(console.error);

    try {
        const qrBase64 = await qrPromise;
        res.json({ status: 'qr_ready', qr: qrBase64 });
    } catch (err) {
        res.status(408).json({ error: err.message });
    }
});

// POST /check-whatsapp
// body: { telefono } — sin indicativo, solo 10 dígitos
router.post('/check-whatsapp', async (req, res) => {
    const { telefono } = req.body;
    if (!telefono) return res.status(400).json({ error: 'telefono requerido' });

    // Usa la sesión del superadmin
    const SESSION_ID = 'superadmin';
    const session = sessions.get(SESSION_ID);

    if (!session || session.status !== 'open') {
        return res.status(503).json({ error: 'Sesión WhatsApp no disponible', exists: null });
    }

    try {
        let numero = telefono.replace(/\D/g, '');
        if (!numero.startsWith('57')) numero = `57${numero}`;

        const [result] = await session.socket.onWhatsApp(numero);
        res.json({ exists: result?.exists ?? false, jid: result?.jid ?? null });
    } catch (e) {
        console.error('[check-whatsapp]', e);
        res.status(500).json({ error: e.message });
    }
});

// DELETE /sessions/:negocioId — cierra sesión y borra credenciales
router.delete('/sessions/:negocioId', async (req, res) => {
    try {
        await disconnectSession(req.params.negocioId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Mensajes ────────────────────────────────────────────

// POST /messages/send
// body: { negocioId, telefono, mensaje }
router.post('/messages/send', async (req, res) => {
    const { negocioId, telefono, mensaje } = req.body;

    if (!negocioId || !telefono || !mensaje) {
        return res.status(400).json({ error: 'negocioId, telefono y mensaje son requeridos' });
    }

    const session = sessions.get(negocioId);

    // Sesión conectando → encolar y responder ok
    if (session?.status === 'connecting') {
        encolarMensaje(negocioId, telefono, mensaje);
        return res.json({ success: true, queued: true });
    }

    // Sesión no existe o desconectada → error claro
    if (!session || session.status !== 'open') {
        return res.status(503).json({ error: `Sesión no disponible para negocio ${negocioId}` });
    }

    try {
        await sendMessage(negocioId, telefono, mensaje);
        res.json({ success: true, queued: false });
    } catch (err) {
        // Si falla al enviar (ej: número inválido, error de red) → no encolar, es un error real
        res.status(500).json({ error: err.message });
    }
});

export default router;
