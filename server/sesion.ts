import { createHash, randomBytes } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type pg from 'pg';
import { config } from './config';
import { pool } from './db';

const COOKIE = 'cc_sesion';
const DURACION_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function abrirSesion(c: pg.Pool | pg.PoolClient, res: Response, usuarioId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  await c.query('DELETE FROM sesiones WHERE usuario_id = $1 AND expira_en < now()', [usuarioId]);
  await c.query('INSERT INTO sesiones (token_hash, usuario_id, expira_en) VALUES ($1, $2, $3)', [
    hashToken(token),
    usuarioId,
    new Date(Date.now() + DURACION_MS),
  ]);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.produccion,
    maxAge: DURACION_MS,
    path: '/',
  });
}

/** El hash de la sesión con la que llegó el pedido. */
export function sesionActual(req: Request): string | null {
  const token = req.cookies?.[COOKIE];
  return typeof token === 'string' ? hashToken(token) : null;
}

export async function cerrarSesion(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[COOKIE];
  if (typeof token === 'string') await pool.query('DELETE FROM sesiones WHERE token_hash = $1', [hashToken(token)]);
  res.clearCookie(COOKIE, { path: '/' });
}

declare module 'express-serve-static-core' {
  interface Request {
    usuario: { id: string; email: string; tipo: 'pyme' | 'persona' };
  }
}

/** Identifica al usuario solo por la cookie: ningún dato del pedido puede cambiarlo. */
export async function requerirSesion(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[COOKIE];
  if (typeof token === 'string') {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.tipo FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.token_hash = $1 AND s.expira_en > now()`,
      [hashToken(token)],
    );
    if (rows[0]) {
      req.usuario = rows[0];
      next();
      return;
    }
  }
  res.status(401).json({ error: 'Tenés que ingresar a tu cuenta.' });
}

/** Rechaza escrituras que vienen de otros sitios (CSRF), como refuerzo de SameSite. */
export function verificarOrigen(req: Request, res: Response, next: NextFunction): void {
  const origen = req.headers.origin;
  if (req.method !== 'GET' && origen && !config.origenes.includes(origen) && !mismoSitio(origen, req.headers.host)) {
    res.status(403).json({ error: 'Pedido rechazado.' });
    return;
  }
  next();
}

/** El pedido viene de la misma dirección que lo recibe, por ejemplo el enlace temporal para el grupo. */
function mismoSitio(origen: string, host: string | undefined): boolean {
  try {
    return Boolean(host) && new URL(origen).host === host;
  } catch {
    return false;
  }
}
