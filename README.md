# API WhatsApp DAPI — NestJS

Microservicio NestJS para envío de mensajes WhatsApp por negocio.
Migrado desde Express/JS puro. Usa Baileys para sesiones y Meta API para plantillas.

## Estructura

```
src/
├── main.ts                        # Bootstrap + CORS + puerto
├── app.module.ts                  # Módulo raíz + middleware API Key
├── common/
│   └── api-key.middleware.ts      # Autenticación por header x-api-key
├── whatsapp/
│   ├── session.service.ts         # Lógica Baileys (sesiones, envío, cola)
│   ├── whatsapp.controller.ts     # Endpoints /sessions y /messages/send
│   └── whatsapp.module.ts
└── meta/
    ├── meta.service.ts            # Envío via Meta WhatsApp Business API
    ├── meta.controller.ts         # Endpoint /messages/send-meta
    └── meta.module.ts
```

## Setup local

```bash
npm install
cp .env.example .env   # edita las variables
npm run dev
```

## Variables de entorno

```env
PORT=3000
API_KEY=tu-clave-secreta
ALLOWED_ORIGIN=https://tuapp.com,http://localhost:4200
META_PHONE_ID=tu-phone-id
META_TOKEN=tu-token-meta
```

## Endpoints

Todos requieren el header: `x-api-key: <tu-clave>`

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /health | Estado del servicio y sesiones activas |
| GET | /sessions | Lista todos los negocios y su estado |
| GET | /sessions/:id/status | Estado de una sesión específica |
| POST | /sessions/:id/connect | Inicia sesión, retorna QR en base64 |
| DELETE | /sessions/:id | Desconecta y borra credenciales |
| POST | /messages/send | Envía mensaje via Baileys |
| POST | /messages/send-meta | Envía plantilla via Meta API |
| POST | /check-whatsapp | Verifica si un número tiene WhatsApp |

## Deploy en Railway

1. Sube este repo a GitHub
2. En Railway: New Project → Deploy from GitHub repo
3. Agrega las variables de entorno en el dashboard
4. Railway detecta el `dockerfile` y hace el build automático
5. ⚠️ Configura un **volumen persistente** en `/app/sessions` para no perder sesiones en redeploys

## Build

```bash
npm run build   # compila TypeScript → dist/
npm start       # corre dist/main.js
```
