// Recuperación de contraseña con PostgreSQL real. El envío de mails se reemplaza para leer el enlace.

import { createHash, randomUUID } from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { urlDeBase } from '../server/scripts/migrar';

const enviados = vi.hoisted(() => [] as { para: string; asunto: string; texto: string }[]);
vi.mock('../server/correo', () => ({
  enviarCorreo: vi.fn(async (correo: { para: string; asunto: string; texto: string }) => {
    enviados.push(correo);
  }),
  correoConfigurado: () => true,
  correoDeRecupero: (enlace: string) => `<a href="${enlace}">Elegir una contraseña nueva</a>`,
}));

const { crearApp } = await import('../server/app');
const { pool } = await import('../server/db');

let servidor: Server;
let base: string;

beforeAll(async () => {
  servidor = crearApp({ limitarIntentos: false }).listen(0, '127.0.0.1');
  await new Promise((ok) => servidor.once('listening', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  servidor.close();
  await pool.end();
});

beforeEach(() => {
  enviados.length = 0;
});

async function pedir(ruta: string, cuerpo?: unknown, cookie?: string) {
  const res = await fetch(base + ruta, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: { ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await res.text();
  return { status: res.status, cuerpo: texto ? JSON.parse(texto) : null, setCookie: res.headers.get('set-cookie') };
}

const RESPUESTAS = { ocupacion: 'empleo', ingresos: 'fijos', hogar: 'solo', cuotas: 'pocas', registro_actual: 'planilla', objetivo: 'ahorrar', experiencia: 'alta' };
const CLAVE = 'clave-original-1';

async function cuenta() {
  const email = `recupero-${randomUUID()}@ejemplo.test`;
  const alta = await pedir('/api/auth/registro', { tipo: 'persona', nombre: 'Prueba', email, clave: CLAVE, plan: 'gratis', respuestas: RESPUESTAS });
  return { email, cookie: alta.setCookie!.split(';')[0] };
}

async function pedirEnlace(email: string) {
  const r = await pedir('/api/auth/recuperar', { email });
  expect(r.status).toBe(200);
  await new Promise((ok) => setTimeout(ok, 20));
  const correo = enviados.at(-1);
  const token = correo?.texto.match(/#token=([\w-]+)/)?.[1];
  return { correo, token };
}

describe('pedir el enlace', () => {
  it('el enlace usa la dirección del grupo si se pidió desde ahí, y nunca una desconocida', async () => {
    const { email } = await cuenta();
    const pedirCon = async (host: string) => {
      enviados.length = 0;
      await fetch(base + '/api/auth/recuperar', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-host': host, 'x-forwarded-proto': 'https' }, body: JSON.stringify({ email }) });
      await new Promise((ok) => setTimeout(ok, 20));
      return enviados.at(-1)?.texto ?? '';
    };
    expect(await pedirCon('linda-prueba-aura.trycloudflare.com')).toContain('https://linda-prueba-aura.trycloudflare.com/restablecer#token=');
    const malicioso = await pedirCon('sitio-malo.example');
    expect(malicioso).not.toContain('sitio-malo');
    expect(malicioso).toContain('http://localhost:4173/restablecer#token=');
  });

  it('manda un mail a la cuenta con un enlace que lleva el token después del #', async () => {
    const { email } = await cuenta();
    const { correo, token } = await pedirEnlace(email);
    expect(correo?.para).toBe(email);
    expect(correo?.texto).toContain(`${base}/restablecer#token=`);
    expect(token).toBeTruthy();
  });

  it('responde igual exista o no la cuenta, y a una inexistente no le manda nada', async () => {
    const { email } = await cuenta();
    const existe = await pedir('/api/auth/recuperar', { email });
    const noExiste = await pedir('/api/auth/recuperar', { email: `nadie-${randomUUID()}@ejemplo.test` });
    expect(existe).toEqual({ ...noExiste, setCookie: null });
    await new Promise((ok) => setTimeout(ok, 20));
    expect(enviados.map((c) => c.para)).toEqual([email]);
  });

  it('acepta el email con mayúsculas y rechaza uno inválido', async () => {
    const { email } = await cuenta();
    await pedir('/api/auth/recuperar', { email: email.toUpperCase() });
    await new Promise((ok) => setTimeout(ok, 20));
    expect(enviados.at(-1)?.para).toBe(email);
    expect((await pedir('/api/auth/recuperar', { email: 'no-es-email' })).status).toBe(400);
  });

  it('la base guarda solo el hash del token', async () => {
    const { email } = await cuenta();
    const { token } = await pedirEnlace(email);
    expect((await pool.query('SELECT 1 FROM recuperaciones WHERE token_hash = $1', [token])).rowCount).toBe(0);
  });
});

describe('elegir la contraseña nueva', () => {
  it('cambia la contraseña: entra con la nueva y ya no con la vieja', async () => {
    const { email } = await cuenta();
    const { token } = await pedirEnlace(email);
    expect((await pedir('/api/auth/restablecer', { token, clave: 'clave-nueva-123' })).status).toBe(200);
    expect((await pedir('/api/auth/ingresar', { email, clave: 'clave-nueva-123' })).status).toBe(200);
    expect((await pedir('/api/auth/ingresar', { email, clave: CLAVE })).status).toBe(401);
  });

  it('cierra las sesiones que estaban abiertas', async () => {
    const { email, cookie } = await cuenta();
    expect((await pedir('/api/yo', undefined, cookie)).status).toBe(200);
    const { token } = await pedirEnlace(email);
    await pedir('/api/auth/restablecer', { token, clave: 'clave-nueva-123' });
    expect((await pedir('/api/yo', undefined, cookie)).status).toBe(401);
  });

  it('el enlace sirve una sola vez, aunque se use dos veces a la vez', async () => {
    const { email } = await cuenta();
    const { token } = await pedirEnlace(email);
    const estados = (await Promise.all([1, 2, 3].map((n) => pedir('/api/auth/restablecer', { token, clave: `clave-nueva-${n}00` })))).map((r) => r.status);
    expect(estados.filter((s) => s === 200)).toHaveLength(1);
    expect((await pedir('/api/auth/restablecer', { token, clave: 'otra-clave-999' })).status).toBe(400);
  });

  it('un enlace vencido no sirve', async () => {
    const { email } = await cuenta();
    const { token } = await pedirEnlace(email);
    // La app no puede cambiar el vencimiento: se lo adelanta con el usuario administrador de la base.
    const admin = new pg.Client({ connectionString: urlDeBase(process.env.DATABASE_ADMIN_URL!, new URL(process.env.DATABASE_TEST_URL!).pathname.slice(1)) });
    await admin.connect();
    await admin.query("UPDATE recuperaciones SET expira_en = now() - interval '1 minute' WHERE token_hash = $1", [createHash('sha256').update(token!).digest('hex')]);
    await admin.end();
    const r = await pedir('/api/auth/restablecer', { token, clave: 'clave-nueva-123' });
    expect(r.status).toBe(400);
    expect(r.cuerpo.error).toContain('Pedí uno nuevo');
    expect((await pedir('/api/auth/ingresar', { email, clave: CLAVE })).status).toBe(200);
  });

  it('un token que nunca existió no sirve', async () => {
    expect((await pedir('/api/auth/restablecer', { token: 'x'.repeat(43), clave: 'clave-nueva-123' })).status).toBe(400);
  });

  it('pedir otro enlace anula el anterior', async () => {
    const { email } = await cuenta();
    const primero = (await pedirEnlace(email)).token;
    const segundo = (await pedirEnlace(email)).token;
    expect((await pedir('/api/auth/restablecer', { token: primero, clave: 'clave-nueva-123' })).status).toBe(400);
    expect((await pedir('/api/auth/restablecer', { token: segundo, clave: 'clave-nueva-123' })).status).toBe(200);
  });

  it('pide una contraseña válida y no la cambia si no lo es', async () => {
    const { email } = await cuenta();
    const { token } = await pedirEnlace(email);
    const corta = await pedir('/api/auth/restablecer', { token, clave: 'corta' });
    expect(corta.status).toBe(400);
    expect(corta.cuerpo.error).toContain('8 caracteres');
    expect((await pedir('/api/auth/restablecer', { token, clave: 'clave-nueva-123' })).status).toBe(200);
  });

  it('rechaza tokens con otra forma', async () => {
    for (const token of ['', 'corto', 'x'.repeat(500)]) {
      expect((await pedir('/api/auth/restablecer', { token, clave: 'clave-nueva-123' })).status).toBe(400);
    }
  });
});
