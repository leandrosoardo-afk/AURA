// Cambio de plan e informes, con PostgreSQL real.

import { randomUUID } from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hoyArgentina } from '../server/acceso';
import { sumarDias } from '../shared/motor';

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
  const texto = await res.text();
  return { status: res.status, cuerpo: texto ? JSON.parse(texto) : null, setCookie: res.headers.get('set-cookie') };
}

const PERSONA = { ocupacion: 'empleo', ingresos: 'fijos', hogar: 'solo', cuotas: 'pocas', registro_actual: 'planilla', objetivo: 'ahorrar', experiencia: 'alta' };

async function cuenta(plan = 'gratis') {
  const email = `informe-${randomUUID()}@ejemplo.test`;
  const alta = await pedir('/api/auth/registro', { metodo: 'POST', cuerpo: { tipo: 'persona', nombre: 'Prueba', email, clave: 'clave-de-prueba-1', plan, respuestas: PERSONA } });
  const cookie = alta.setCookie!.split(';')[0];
  const yo = await pedir('/api/yo', { cookie });
  return { cookie, espacioId: yo.cuerpo.espacios[0].id as string };
}

describe('cambiar de plan', () => {
  it('sube de Gratis a Full y baja a Intermedio', async () => {
    const { cookie } = await cuenta('gratis');
    expect((await pedir('/api/suscripcion', { metodo: 'PUT', cuerpo: { plan: 'full' }, cookie })).status).toBe(200);
    expect((await pedir('/api/yo', { cookie })).cuerpo.plan.codigo).toBe('full');
    expect((await pedir('/api/suscripcion', { metodo: 'PUT', cuerpo: { plan: 'intermedio' }, cookie })).status).toBe(200);
    expect((await pedir('/api/yo', { cookie })).cuerpo.plan.codigo).toBe('intermedio');
  });

  it('no acepta un plan inexistente ni sin sesión', async () => {
    const { cookie } = await cuenta();
    expect((await pedir('/api/suscripcion', { metodo: 'PUT', cuerpo: { plan: 'platino' }, cookie })).status).toBe(400);
    expect((await pedir('/api/suscripcion', { metodo: 'PUT', cuerpo: { plan: 'full' } })).status).toBe(401);
  });

  it('el plan nuevo habilita y deshabilita módulos en el servidor', async () => {
    const { cookie, espacioId } = await cuenta('gratis');
    const ruta = `/api/espacios/${espacioId}/informe?desde=2026-01-01&hasta=2026-12-31`;
    expect((await pedir(ruta, { cookie })).status).toBe(403);
    await pedir('/api/suscripcion', { metodo: 'PUT', cuerpo: { plan: 'full' }, cookie });
    expect((await pedir(ruta, { cookie })).status).toBe(200);
    await pedir('/api/suscripcion', { metodo: 'PUT', cuerpo: { plan: 'gratis' }, cookie });
    expect((await pedir(ruta, { cookie })).status).toBe(403);
  });
});

describe('informe', () => {
  it('junta movimientos del período, totales por categoría, caja y futuros', async () => {
    const { cookie, espacioId } = await cuenta('full');
    const hoy = hoyArgentina();
    const mov = (tipo: string, monto: number, categoria: string, fecha: string) =>
      pedir(`/api/espacios/${espacioId}/movimientos`, { metodo: 'POST', cuerpo: { tipo, monto, concepto: `${categoria} prueba`, categoria, fecha }, cookie });
    await mov('ingreso', 100_000, 'Sueldo', sumarDias(hoy, -5));
    await mov('egreso', 30_000, 'Comida', sumarDias(hoy, -4));
    await mov('egreso', 20_000, 'Comida', sumarDias(hoy, -3));
    await mov('egreso', 999_000, 'Vivienda', sumarDias(hoy, -400));
    await mov('egreso', 15_000, 'Servicios', sumarDias(hoy, 3));
    await pedir(`/api/espacios/${espacioId}/compromisos`, { metodo: 'POST', cuerpo: { tipo: 'cobro', monto: 50_000, concepto: 'Cobro agendado', categoria: 'Sueldo', fecha: sumarDias(hoy, 10), mensual: false, avisoDias: 1 }, cookie });

    const r = await pedir(`/api/espacios/${espacioId}/informe?desde=${sumarDias(hoy, -30)}&hasta=${sumarDias(hoy, 30)}`, { cookie });
    expect(r.status).toBe(200);
    const inf = r.cuerpo;
    expect(inf.movimientos.totales).toEqual({ ingresos: 100_000, egresos: 65_000, neto: 35_000, cantidad: 4 });
    expect(inf.movimientos.categorias).toContainEqual({ tipo: 'egreso', categoria: 'Comida', total: 50_000, cantidad: 2 });
    expect(inf.movimientos.lista.find((m: { categoria: string }) => m.categoria === 'Servicios').programado).toBe(true);
    expect(inf.caja.saldo).toBe(100_000 - 50_000 - 999_000);
    expect(inf.caja.dias).toHaveLength(31);
    expect(inf.caja.minimo).toEqual({ dia: expect.any(Number), saldo: Math.min(...inf.caja.dias.map((d: { saldo: number }) => d.saldo)) });
    expect(inf.futuros.pagos).toBe(15_000);
    expect(inf.futuros.cobros).toBe(50_000);
    expect(inf.titular).toBe('Prueba');
  });

  it('valida el período y no deja ver espacios ajenos', async () => {
    const a = await cuenta('full');
    const b = await cuenta('full');
    expect((await pedir(`/api/espacios/${a.espacioId}/informe?desde=2026-05-01&hasta=2026-04-01`, { cookie: a.cookie })).status).toBe(400);
    expect((await pedir(`/api/espacios/${a.espacioId}/informe?desde=2026-04-01`, { cookie: a.cookie })).status).toBe(400);
    expect((await pedir(`/api/espacios/${a.espacioId}/informe?desde=2026-01-01&hasta=2026-12-31`, { cookie: b.cookie })).status).toBe(404);
  });
});
