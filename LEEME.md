# Aura (ex Caja Clara) V4

Necesitás Node y PostgreSQL corriendo en tu máquina. Abrí esta carpeta en Antigravity o en una terminal:

```bash
npm install
```

```bash
npm run db:crear
```

```bash
npm run dev
```

- App: http://localhost:4173
- Landing: http://localhost:4173/landing
- Alta: http://localhost:4173/registro

`npm run db:crear` genera el archivo `.env` con una clave aleatoria, el rol de la app, las dos bases y las tablas. Se puede correr más de una vez.

Si tu PostgreSQL usa otro usuario administrador, indicalo la primera vez:

```bash
DATABASE_ADMIN_URL=postgres://usuario:clave@localhost:5432/postgres npm run db:crear
```

Para que el chatbot use IA, sacá una clave en https://aistudio.google.com/apikey y pegala en `.env`, en `GEMINI_API_KEY=`. Sin clave, responde la guía local.

Pruebas: `npm test`. Compilación: `npm run build`.

Qué está hecho y qué falta: [ESPECIFICACION_V4.md](ESPECIFICACION_V4.md).

## Compartir la app con el grupo (Docker + enlace de Cloudflare)

`docker-compose.yml` levanta dos contenedores que se reinician solos:

- **app**: compila la web y la sirve junto con la API (puerto 3101 adentro; en esta Mac, http://127.0.0.1:8090). Usa la PostgreSQL de esta Mac (`DATABASE_HOST=host.docker.internal`), así que las cuentas son las mismas que en `npm run dev`.
- **tunel**: `cloudflared` publica la app en un enlace `https://….trycloudflare.com`.

```bash
docker compose up -d --build
```

```bash
npm run enlace
```

- Funciona mientras la Mac esté prendida, despierta y con Docker Desktop abierto. Si Docker arranca solo al iniciar sesión, los contenedores vuelven solos.
- El enlace cambia cuando se reinicia el contenedor `tunel` (o Docker, o la Mac). `npm run enlace` muestra el actual.
- Después de cambiar código, `docker compose up -d --build` actualiza la app sin tocar el túnel, así el enlace se mantiene.
- Para apagarlo: `docker compose down`.
