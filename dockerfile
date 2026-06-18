FROM node:20-alpine

WORKDIR /app

# Instalar dependencias primero (cache layer)
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar código fuente
COPY src/ ./src/

EXPOSE 8080

# CMD directo a node — Railway envía SIGTERM limpio sin pasar por npm
CMD ["node", "src/index.js"]