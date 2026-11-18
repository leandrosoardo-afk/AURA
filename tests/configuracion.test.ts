// Configuración del perfil con PostgreSQL real: nombre, apellido, negocio, foto y contraseña.

import { randomUUID } from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

async function pedir(ruta: string, { metodo = 'GET', cuerpo, cookie }: { metodo?: string; cuerpo?: unknown; cookie?: string } = {}) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const tipo = res.headers.get('content-type') ?? '';
  const cuerpoRes = tipo.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, cuerpo: cuerpoRes, tipo, setCookie: res.headers.get('set-cookie') };
}

const PERSONA = { ocupacion: 'empleo', ingresos: 'fijos', hogar: 'solo', cuotas: 'pocas', registro_actual: 'planilla', objetivo: 'ahorrar', experiencia: 'alta' };
const PYME = { rubro: 'comercio', empleados: 'solo', medios_cobro: ['efectivo'], condicion_fiscal: 'monotributo', registro_actual: 'cuaderno', preocupacion: 'vencimientos', experiencia: 'alta' };
const CLAVE = 'clave-original-1';
// Un PNG de 1x1 px.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function cuenta(tipo: 'persona' | 'pyme' = 'persona') {
  const email = `config-${randomUUID()}@ejemplo.test`;
  const alta = await pedir('/api/auth/registro', {
    metodo: 'POST',
    cuerpo: { tipo, nombre: 'Prueba', nombreNegocio: tipo === 'pyme' ? 'Kiosco Viejo' : undefined, email, clave: CLAVE, plan: 'gratis', respuestas: tipo === 'pyme' ? PYME : PERSONA },
  });
  expect(alta.status).toBe(201);
  return { email, cookie: alta.setCookie!.split(';')[0] };
}

describe('datos del perfil', () => {
  it('guarda nombre y apellido, y /yo los devuelve', async () => {
    const { cookie } = await cuenta();
    const r = await pedir('/api/perfil', { metodo: 'PUT', cuerpo: { nombre: '  Silvina ', apellido: 'Álvarez' }, cookie });
    expect(r.status).toBe(200);
    const yo = await pedir('/api/yo', { cookie });
    expect(yo.cuerpo.perfil).toMatchObject({ nombre: 'Silvina', apellido: 'Álvarez', fotoVersion: null });
  });

  it('no acepta un nombre vacío', async () => {
    const { cookie } = await cuenta();
    const r = await pedir('/api/perfil', { metodo: 'PUT', cuerpo: { nombre: '   ', apellido: 'X' }, cookie });
    expect(r.status).toBe(400);
    expect(r.cuerpo.error).toBe('Escribí tu nombre.');
  });

  it('en una PyME cambia también el nombre del espacio de trabajo', async () => {
    const { cookie } = await cuenta('pyme');
    await pedir('/api/perfil', { metodo: 'PUT', cuerpo: { nombre: 'Ana', apellido: '', nombreNegocio: 'Kiosco Nuevo' }, cookie });
    const yo = await pedir('/api/yo', { cookie });
    expect(yo.cuerpo.perfil.nombreNegocio).toBe('Kiosco Nuevo');
    expect(yo.cuerpo.espacios[0].nombre).toBe('Kiosco Nuevo');
  });

  it('sin sesión no se puede editar nada', async () => {
    expect((await pedir('/api/perfil', { metodo: 'PUT', cuerpo: { nombre: 'X' } })).status).toBe(401);
    expect((await pedir('/api/perfil/foto', { metodo: 'PUT', cuerpo: { foto: PNG } })).status).toBe(401);
    expect((await pedir('/api/perfil/foto')).status).toBe(401);
  });

  it('cada uno edita solo su perfil', async () => {
    const a = await cuenta();
    const b = await cuenta();
    await pedir('/api/perfil', { metodo: 'PUT', cuerpo: { nombre: 'Cambiado', apellido: 'Por A' }, cookie: a.cookie });
    const yoB = await pedir('/api/yo', { cookie: b.cookie });
    expect(yoB.cuerpo.perfil.nombre).toBe('Prueba');
  });
});

describe('foto de perfil', () => {
  it('sube, devuelve la imagen y la borra', async () => {
    const { cookie } = await cuenta();
    expect((await pedir('/api/perfil/foto', { cookie })).status).toBe(404);
    expect((await pedir('/api/perfil/foto', { metodo: 'PUT', cuerpo: { foto: PNG }, cookie })).status).toBe(200);

    const foto = await pedir('/api/perfil/foto', { cookie });
    expect(foto.status).toBe(200);
    expect(foto.tipo).toBe('image/png');
    expect((foto.cuerpo as Buffer).subarray(1, 4).toString()).toBe('PNG');
    const yo = await pedir('/api/yo', { cookie });
    expect(yo.cuerpo.perfil.fotoVersion).toMatch(/^[0-9a-f]{10}$/);

    expect((await pedir('/api/perfil/foto', { metodo: 'DELETE', cookie })).status).toBe(200);
    expect((await pedir('/api/perfil/foto', { cookie })).status).toBe(404);
  });

  it('rechaza lo que no es una imagen permitida', async () => {
    const { cookie } = await cuenta();
    for (const foto of ['hola', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGI+aG9sYTwvYj4=', PNG + '<script>']) {
      expect((await pedir('/api/perfil/foto', { metodo: 'PUT', cuerpo: { foto }, cookie })).status).toBe(400);
    }
  });

  it('rechaza una foto demasiado grande', async () => {
    const { cookie } = await cuenta();
    const grande = 'data:image/jpeg;base64,' + 'A'.repeat(420_000);
    expect((await pedir('/api/perfil/foto', { metodo: 'PUT', cuerpo: { foto: grande }, cookie })).status).toBe(400);
  });
});

describe('cambiar la contraseña', () => {
  it('con la actual correcta la cambia, deja esta sesión y cierra las demás', async () => {
    const { email, cookie } = await cuenta();
    const otra = await pedir('/api/auth/ingresar', { metodo: 'POST', cuerpo: { email, clave: CLAVE } });
    const otraCookie = otra.setCookie!.split(';')[0];

    const r = await pedir('/api/auth/cambiar-clave', { metodo: 'POST', cuerpo: { actual: CLAVE, nueva: 'clave-nueva-123' }, cookie });
    expect(r.status).toBe(200);
    expect((await pedir('/api/yo', { cookie })).status).toBe(200);
    expect((await pedir('/api/yo', { cookie: otraCookie })).status).toBe(401);

    expect((await pedir('/api/auth/ingresar', { metodo: 'POST', cuerpo: { email, clave: CLAVE } })).status).toBe(401);
    expect((await pedir('/api/auth/ingresar', { metodo: 'POST', cuerpo: { email, clave: 'clave-nueva-123' } })).status).toBe(200);
  });

  it('con la actual incorrecta no cambia nada', async () => {
    const { email, cookie } = await cuenta();
    const r = await pedir('/api/auth/cambiar-clave', { metodo: 'POST', cuerpo: { actual: 'otra-cosa-99', nueva: 'clave-nueva-123' }, cookie });
    expect(r.status).toBe(400);
    expect(r.cuerpo.error).toBe('La contraseña actual no coincide.');
    expect((await pedir('/api/auth/ingresar', { metodo: 'POST', cuerpo: { email, clave: CLAVE } })).status).toBe(200);
  });

  it('pide una contraseña nueva de 8 caracteres o más', async () => {
    const { cookie } = await cuenta();
    const r = await pedir('/api/auth/cambiar-clave', { metodo: 'POST', cuerpo: { actual: CLAVE, nueva: 'corta' }, cookie });
    expect(r.status).toBe(400);
    expect(r.cuerpo.error).toBe('La contraseña necesita al menos 8 caracteres.');
  });
});
