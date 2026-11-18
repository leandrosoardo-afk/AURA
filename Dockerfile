# AURA en un contenedor: compila la web y la sirve junto con la API en el puerto 3101.
FROM node:24-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    API_PORT=3101 \
    SERVIR_WEB=1
EXPOSE 3101
CMD ["npx", "tsx", "server/index.ts"]
