// Controles de seguridad de la lista "antes de lanzar tu app", con PostgreSQL real.

import { randomUUID } from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const enviados = vi.hoisted(() => [] as unknown[]);
vi.mock('../server/correo', () => ({
  enviarCorreo: vi.fn(async (correo: unknown) => {
    enviados.push(correo);
  }),
  correoConfigurado: () => true,
  correoDeRecupero: (enlace: string) => enlace,
}));

const { crearApp } = await import('../server/app');
const { pool } = await import('../server/db');

const abiertos: Server[] = [];
async function levantar(opciones: Parameters<typeof crearApp>[0] = { limitarIntentos: false }) {
  const s = crearApp(opciones).listen(0, '127.0.0.1');
  await new Promise((ok) => s.once('listening', ok));
  abiertos.push(s);
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

let base: string;
beforeAll(async () => {
  base = await levantar();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  abiertos.forEach((s) => s.close());
  await pool.end();
});

async function pedir(destino: string, ruta: string, cuerpo?: unknown, encabezados: Record<string, string> = {}) {
  const res = await fetch(destino + ruta, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    redirect: 'manual',
    headers: { ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}), ...encabezados },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await res.text();
  let json: any = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  return { status: res.status, cuerpo: json, headers: res.headers };
}

const RESPUESTAS = { ocupacion: 'empleo', ingresos: 'fijos', hogar: 'solo', cuotas: 'pocas', registro_actual: 'planilla', objetivo: 'ahorrar', experiencia: 'alta' };
const alta = (extra: object = {}) => ({ tipo: 'persona', nombre: 'Prueba', email: `seguridad-${randomUUID()}@ejemplo.test`, clave: 'clave-de-prueba-1', plan: 'gratis', respuestas: RESPUESTAS, ...extra });

describe('protección contra bots', () => {
  it('rechaza el registro si se completó el campo trampa', async () => {
    expect((await pedir(base, '/api/auth/registro', alta({ sitio: 'http://spam.example' }))).status).toBe(400);
  });

  it('rechaza el registro si se envió en menos de un segundo y medio', async () => {
    expect((await pedir(base, '/api/auth/registro', alta({ sitio: '', demora: 300 }))).status).toBe(400);
  });

  it('una persona que tardó lo normal se registra', async () => {
    expect((await pedir(base, '/api/auth/registro', alta({ sitio: '', demora: 25_000 }))).status).toBe(201);
  });

  it('al bot del recupero le responde igual pero no manda ningún mail', async () => {
    const datos = alta();
    await pedir(base, '/api/auth/registro', datos);
    enviados.length = 0;
    const r = await pedir(base, '/api/auth/recuperar', { email: datos.email, sitio: 'x' });
    expect(r.status).toBe(200);
    await new Promise((ok) => setTimeout(ok, 30));
    expect(enviados).toHaveLength(0);
  });
});

describe('límites de pedidos', () => {
  it('después de 10 intentos fallidos con la misma cuenta, la frena', async () => {
    const destino = await levantar({ limitarIntentos: true });
    const datos = alta();
    await pedir(destino, '/api/auth/registro', datos);
    const estados: number[] = [];
    for (let i = 0; i < 11; i++) estados.push((await pedir(destino, '/api/auth/ingresar', { email: datos.email, clave: `mala-${i}` }, { 'x-forwarded-for': `10.0.0.${i + 1}` })).status);
    expect(estados.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(estados[10]).toBe(429);
  });

  it('el tope general de la API corta a quien manda pedidos en masa', async () => {
    const destino = await levantar({ limitarIntentos: false, limiteGeneral: 3 });
    const estados = [];
    for (let i = 0; i < 4; i++) estados.push((await pedir(destino, '/api/planes')).status);
    expect(estados).toEqual([200, 200, 200, 429]);
  });
});

describe('encabezados y HTTPS', () => {
  it('manda los encabezados de seguridad', async () => {
    const r = await pedir(base, '/api/planes');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(r.headers.get('strict-transport-security')).toContain('max-age=');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('permissions-policy')).toContain('camera=(self)');
    expect(r.headers.get('permissions-policy')).toContain('microphone=(self)');
    expect(r.headers.get('permissions-policy')).toContain('geolocation=()');
    expect(r.headers.get('x-powered-by')).toBeNull();
  });

  it('en producción, un pedido por http al enlace público se manda a https', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const r = await pedir(base, '/api/planes', undefined, { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'algo.trycloudflare.com' });
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('https://algo.trycloudflare.com/api/planes');
  });
});

describe('solo los datos necesarios', () => {
  it('ninguna respuesta de la cuenta trae la contraseña ni el token de sesión', async () => {
    const datos = alta();
    const res = await fetch(base + '/api/auth/registro', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(datos) });
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const token = cookie.split(';')[0].split('=')[1];
    const yo = await pedir(base, '/api/yo', undefined, { cookie: cookie.split(';')[0] });
    const texto = JSON.stringify(yo.cuerpo);
    expect(texto).not.toMatch(/clave|hash|\$2[aby]\$/i);
    expect(texto).not.toContain(token);
  });
});
