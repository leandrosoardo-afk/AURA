import cookieParser from 'cookie-parser';
import { resolve } from 'path';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { ErrorHttp } from './acceso';
import { pool } from './db';
import { rutasAuth } from './rutas/auth';
import { rutasAyuda } from './rutas/ayuda';
import { rutasEspacios } from './rutas/espacios';
import { rutasMercado } from './rutas/mercado';
import { rutasPerfil } from './rutas/perfil';
import { verificarOrigen } from './sesion';

export function crearApp({ limitarIntentos = true, limiteAyuda = 30, limiteGeneral = 600 } = {}) {
  const app = express();
  // Detrás del proxy de Vite (o del túnel en Docker) la IP real llega en X-Forwarded-For.
  // Solo se confía en saltos locales, así cada persona tiene su propio límite de intentos.
  app.set('trust proxy', config.proxiesConfiables);
  app.disable('x-powered-by');

  // HTTPS obligatorio: si alguien entra por http al enlace público, se lo manda a https.
  // (En esta Mac, por localhost, no hace falta: el tráfico no sale de la computadora.)
  app.use((req, res, next) => {
    const protocolo = req.get('x-forwarded-proto')?.split(',')[0].trim();
    const host = (req.get('x-forwarded-host') ?? req.get('host') ?? '').split(',')[0].trim();
    if (process.env.NODE_ENV === 'production' && protocolo === 'http' && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
      res.redirect(301, `https://${host}${req.originalUrl}`);
      return;
    }
    next();
  });

  app.use(helmet());
  // Qué puede usar la página del dispositivo: cámara (foto de perfil) y micrófono (dictarle al asistente); nada más.
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()');
    next();
  });
  // Tope general por IP para toda la API: frena a quien manda pedidos en masa.
  app.use(
    '/api',
    rateLimit({
      windowMs: 5 * 60 * 1000,
      limit: limiteGeneral,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Estás haciendo demasiados pedidos. Esperá unos minutos y probá de nuevo.' },
    }),
  );
  // Una planilla de 5000 filas pesa bastante más que cualquier otro pedido.
  app.use('/api/espacios/:espacioId/movimientos/importar', express.json({ limit: '2mb' }));
  // La foto de perfil llega achicada, pero igual pesa más que un pedido común.
  app.use('/api/perfil/foto', express.json({ limit: '512kb' }));
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.use('/api', verificarOrigen);

  // Público: el alta necesita mostrar los precios antes de que exista la cuenta.
  app.get('/api/planes', async (_req, res) => {
    const { rows } = await pool.query(
      'SELECT codigo, nombre, precio_mensual_ars, incluye_publicidad, limite_registros_mes, modulos, beneficios FROM planes ORDER BY orden',
    );
    res.json({ planes: rows });
  });

  app.use('/api', rutasAuth(limitarIntentos));
  app.use('/api', rutasEspacios());
  app.use('/api', rutasMercado());
  app.use('/api', rutasPerfil());
  app.use('/api', rutasAyuda({ limitePorUsuario: limiteAyuda }));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'No existe esa ruta.' });
  });

  if (config.servirWeb) {
    const web = resolve(import.meta.dirname, '../dist');
    app.use(express.static(web, { index: false }));
    app.get(['/landing', '/landing/'], (_req, res) => res.sendFile(resolve(web, 'landing.html')));
    // Las demás direcciones son pantallas de la app: las resuelve React.
    app.get('/{*ruta}', (_req, res) => res.sendFile(resolve(web, 'index.html')));
  }

  app.use((error: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ErrorHttp) {
      res.status(error.status).json(error.cuerpo);
      return;
    }
    if (error.status && error.status < 500) {
      res.status(error.status).json({ error: 'Pedido inválido.' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Algo falló en el servidor. Probá de nuevo.' });
  });

  return app;
}
