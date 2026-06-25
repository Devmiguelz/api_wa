FROM node:20-alpine

WORKDIR /app

# Instalar dependencias (incluyendo devDependencies para el build)
COPY package*.json ./
RUN npm ci

# Copiar fuente y compilar TypeScript
COPY . .
RUN npm run build

# Limpiar devDependencies después del build
RUN npm prune --omit=dev

EXPOSE 3000

CMD ["node", "dist/main.js"]
