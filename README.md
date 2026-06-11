# whatsapp-service

Microservicio Node.js para envío de mensajes WhatsApp por negocio.
Usa [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) — conexión por QR scan, sin costo.

## Setup

```bash
npm install
cp .env.example .env   # edita API_KEY y ALLOWED_ORIGIN
npm run dev
```

## Endpoints

Todos requieren el header: `x-api-key: <tu-clave>`

### Conectar un negocio (escanear QR)
```
POST /sessions/:negocioId/connect
```
Respuesta:
```json
{ "status": "qr_ready", "qr": "data:image/png;base64,..." }
```
Muestra el `qr` como `<img src="...">` en el panel admin. El negocio lo escanea con WhatsApp.

### Ver estado de una sesión
```
GET /sessions/:negocioId/status
```
Respuesta: `{ "status": "open" | "connecting" | "disconnected" }`

### Ver todas las sesiones
```
GET /sessions
```

### Desconectar / cerrar sesión
```
DELETE /sessions/:negocioId
```

### Enviar mensaje
```
POST /messages/send
{
  "negocioId": "uuid-del-negocio",
  "telefono": "573001234567",
  "mensaje": "¡Tu pedido #123 está en camino! 🛵"
}
```

## Sesiones persistentes

Las credenciales se guardan en `/sessions/:negocioId/`. Al reiniciar el servidor, reconecta automáticamente todos los negocios que tenían sesión activa — no necesitan re-escanear el QR.

## Deploy en Railway

1. Crea un nuevo proyecto en [railway.app](https://railway.app)
2. Conecta este repo
3. Agrega las variables de entorno (`API_KEY`, `ALLOWED_ORIGIN`)
4. Railway detecta el `package.json` y despliega automáticamente

> ⚠️ Asegúrate de usar un **volumen persistente** en Railway para la carpeta `/sessions`, de lo contrario las sesiones se pierden al redeploy.

## Integración desde Angular

```typescript
// En el servicio de pedidos, al cambiar estado:
await this.http.post(`${WA_SERVICE_URL}/messages/send`, {
  negocioId: pedido.negocio_id,
  telefono: pedido.cliente_telefono,
  mensaje: `Tu pedido #${pedido.numero} ahora está: *${nuevoEstado}* ✅`
}, {
  headers: { 'x-api-key': environment.waServiceKey }
}).toPromise();
```
