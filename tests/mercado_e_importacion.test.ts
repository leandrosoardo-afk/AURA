// Mercado con las fuentes simuladas (para probar sus fallas) e importación contra PostgreSQL real.

import { randomUUID } from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../server/app';
import { conUsuario, pool } from '../server/db';
import { BANCOS_PRINCIPALES, depurarCreditos, dolar, limpiarCacheMercado, plazoFijo, resumirCreditos } from '../server/mercado';

let servidor: Server;
let base: string;
const fetchReal = globalThis.fetch;

beforeAll(async () => {
  servidor = crearApp({ limitarIntentos: false }).listen(0, '127.0.0.1');
  await new Promise((ok) => servidor.once('listening', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  servidor.close();
  await pool.end();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  limpiarCacheMercado();
});

const RESPUESTAS = { ocupacion: 'empleo', ingresos: 'fijos', hogar: 'solo', cuotas: 'pocas', registro_actual: 'planilla', objetivo: 'ahorrar', experiencia: 'alta' };

async function pedir(ruta: string, cookie: string | null, metodo = 'GET', cuerpo?: unknown) {
  const res = await fetchReal(base + ruta, {
    method: metodo,
    headers: { ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await res.text();
  return { status: res.status, cuerpo: texto ? JSON.parse(texto) : null, setCookie: res.headers.get('set-cookie') };
}

async function cuenta(plan: 'gratis' | 'intermedio' | 'full') {
  const alta = await pedir('/api/auth/registro', null, 'POST', { tipo: 'persona', nombre: 'Prueba', email: `imp-${randomUUID()}@ejemplo.test`, clave: 'clave-de-prueba-1', plan, respuestas: RESPUESTAS });
  const cookie = alta.setCookie!.split(';')[0];
  const yo = (await pedir('/api/yo', cookie)).cuerpo;
  return { cookie, usuarioId: yo.usuario.id as string, espacioId: yo.espacios[0].id as string, espacio: `/api/espacios/${yo.espacios[0].id}` };
}

const fila = (i: number, extra = {}) => ({ tipo: 'egreso', monto: 1000 + i, concepto: `Gasto ${i}`, categoria: 'Otros gastos', fecha: '2026-09-01', ...extra });

describe('importar movimientos', () => {
  it('guarda las filas, actualiza saldo y historial, y no duplica al reimportar', async () => {
    const c = await cuenta('full');
    const filas = [{ tipo: 'ingreso', monto: 50000, concepto: 'Ventas', categoria: 'Ventas', fecha: '2026-09-01' }, fila(1), fila(2)];
    const r = await pedir(`${c.espacio}/movimientos/importar`, c.cookie, 'POST', { filas });
    expect(r.status).toBe(201);
    expect(r.cuerpo).toMatchObject({ importados: 3, repetidos: 0 });

    const mov = (await pedir(`${c.espacio}/movimientos`, c.cookie)).cuerpo;
    expect(mov.movimientos).toHaveLength(3);
    expect(mov.resumen.saldo).toBe(50000 - 1001 - 1002);

    const otra = await pedir(`${c.espacio}/movimientos/importar`, c.cookie, 'POST', { filas });
    expect(otra.cuerpo).toMatchObject({ importados: 0, repetidos: 3, importacionId: null });
    expect((await pedir(`${c.espacio}/movimientos`, c.cookie)).cuerpo.movimientos).toHaveLength(3);

    const salud = (await pedir(`${c.espacio}/salud`, c.cookie)).cuerpo;
    expect(salud.historial[salud.historial.length - 1].mes).toBe('2026-09');
  });

  it('dos gastos iguales en el mismo archivo siguen siendo dos', async () => {
    const c = await cuenta('full');
    const r = await pedir(`${c.espacio}/movimientos/importar`, c.cookie, 'POST', { filas: [fila(1), fila(1)] });
    expect(r.cuerpo.importados).toBe(2);
    expect((await pedir(`${c.espacio}/movimientos/importar`, c.cookie, 'POST', { filas: [fila(1), fila(1), fila(1)] })).cuerpo).toMatchObject({ importados: 1, repetidos: 2 });
  });

  it('deshacer saca solo esa importación', async () => {
    const c = await cuenta('full');
    await pedir(`${c.espacio}/movimientos`, c.cookie, 'POST', fila(9));
    const r = await pedir(`${c.espacio}/movimientos/importar`, c.cookie, 'POST', { filas: [fila(1), fila(2)] });
    const d = await pedir(`${c.espacio}/importaciones/${r.cuerpo.importacionId}`, c.cookie, 'DELETE');
    expect(d.cuerpo.borrados).toBe(2);
    expect((await pedir(`${c.espacio}/movimientos`, c.cookie)).cuerpo.movimientos.map((m: any) => m.concepto)).toEqual(['Gasto 9']);
    expect((await pedir(`${c.espacio}/importaciones/${r.cuerpo.importacionId}`, c.cookie, 'DELETE')).status).toBe(404);
  });

  it('el plan Gratis no se saltea importando: entra todo o no entra nada', async () => {
    const c = await cuenta('gratis');
    const muchas = Array.from({ length: 31 }, (_, i) => fila(i));
    const r = await pedir(`${c.espacio}/movimientos/importar`, c.cookie, 'POST', { filas: muchas });
    expect(r.status).toBe(403);
    expect(r.cuerpo.codigo).toBe('limite_plan');
    expect((await pedir(`${c.espacio}/movimientos`, c.cookie)).cuerpo.movimientos).toHaveLength(0);
    expect((await pedir(`${c.espacio}/movimientos/importar`, c.cookie, 'POST', { filas: muchas.slice(0, 30) })).status).toBe(201);
    expect((await pedir(`${c.espacio}/movimientos/importar`, c.cookie, 'POST', { filas: [fila(99)] })).status).toBe(403);
  });

  it('una importación grande entra entera', async () => {
    const c = await cuenta('full');
    const filas = Array.from({ length: 5000 }, (_, i) => fila(i));
    const r = await pedir(`${c.espacio}/movimientos/importar`, c.cookie, 'POST', { filas });
    expect(r.cuerpo.importados).toBe(5000);
  });

  it('rechaza un archivo con una fila inválida, vacío o demasiado largo, sin guardar nada', async () => {
    const c = await cuenta('full');
    for (const filas of [[fila(1), fila(2, { monto: -5 })], [fila(1, { fecha: 'ayer' })], [], Array.from({ length: 5001 }, (_, i) => fila(i))]) {
      expect((await pedir(`${c.espacio}/movimientos/importar`, c.cookie, 'POST', { filas })).status).toBe(400);
    }
    expect((await pedir(`${c.espacio}/movimientos`, c.cookie)).cuerpo.movimientos).toHaveLength(0);
  });

  it('otros pedidos siguen limitados a 32 kB', async () => {
    const c = await cuenta('full');
    const r = await pedir(`${c.espacio}/movimientos`, c.cookie, 'POST', { ...fila(1), relleno: 'x'.repeat(40_000) });
    expect(r.status).toBe(413);
  });

  it('nadie importa ni deshace en el espacio de otro, ni ve su salud', async () => {
    const ana = await cuenta('full');
    const beto = await cuenta('full');
    const hecha = await pedir(`${ana.espacio}/movimientos/importar`, ana.cookie, 'POST', { filas: [fila(1)] });
    const id = hecha.cuerpo.importacionId;
    for (const r of [
      await pedir(`${ana.espacio}/movimientos/importar`, beto.cookie, 'POST', { filas: [fila(2)] }),
      await pedir(`${ana.espacio}/importaciones/${id}`, beto.cookie, 'DELETE'),
      await pedir(`${beto.espacio}/importaciones/${id}`, beto.cookie, 'DELETE'),
      await pedir(`${ana.espacio}/salud`, beto.cookie),
    ]) {
      expect(r.status).toBe(404);
    }
    expect((await pedir(`${ana.espacio}/movimientos`, ana.cookie)).cuerpo.movimientos).toHaveLength(1);
    expect((await pedir(`${ana.espacio}/salud`, null)).status).toBe(401);
    const directo = await conUsuario(beto.usuarioId, (c) => c.query('DELETE FROM movimientos WHERE importacion_id = $1', [id]));
    expect(directo.rowCount).toBe(0);
  });
});

describe('salud y caja estimada desde la historia', () => {
  it('con lo importado calcula la salud y arma la caja sin pedir datos', async () => {
    const c = await cuenta('full');
    const hoy = new Date(Date.now() - 3 * 36e5);
    const dia = (n: number) => new Date(hoy.getTime() - n * 864e5).toISOString().slice(0, 10);
    const filas = Array.from({ length: 40 }, (_, i) => [
      { tipo: 'ingreso', monto: 10000, concepto: 'Ventas', categoria: 'Ventas', fecha: dia(i + 1) },
      { tipo: 'egreso', monto: 7000, concepto: 'Gastos', categoria: 'Otros gastos', fecha: dia(i + 1) },
    ]).flat();
    await pedir(`${c.espacio}/movimientos/importar`, c.cookie, 'POST', { filas });

    const { salud, historial } = (await pedir(`${c.espacio}/salud`, c.cookie)).cuerpo;
    expect(salud.puntaje).not.toBeNull();
    expect(historial.length).toBeGreaterThanOrEqual(1);

    const caja = (await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo;
    expect(caja.configurada).toBe(true);
    // 40 días con movimientos y hoy, que todavía no tiene: el promedio es sobre 41 días.
    expect(caja.diasHistoria).toBe(41);
    expect(caja.parametros.reserva).toBe(0);
    expect(caja.parametros.ventaDiaria).toBeCloseTo((40 * 10000) / 41, 6);
    expect(caja.parametros.gastoDiario).toBeCloseTo((40 * 7000) / 41, 6);

    await pedir(`${c.espacio}/parametros`, c.cookie, 'PUT', { reserva: 50000 });
    const guardada = (await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo;
    expect(guardada.parametros.reserva).toBe(50000);
    expect(guardada.parametros.gastoDiario).toBeCloseTo((40 * 7000) / 41, 6);
  });

  it('sin historia sigue pidiendo los datos y la salud queda en gris', async () => {
    const c = await cuenta('gratis');
    expect((await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo).toEqual({ configurada: false });
    expect((await pedir(`${c.espacio}/salud`, c.cookie)).cuerpo.salud).toMatchObject({ puntaje: null, nivel: 'gris' });
  });
});

describe('mercado', () => {
  const DOLARES = [{ casa: 'oficial', nombre: 'Oficial', compra: 1520, venta: 1570, fechaActualizacion: '2026-11-04T18:00:00.000Z' }];

  function fuente(respuestas: (url: string) => unknown) {
    const llamado = vi.fn(async (url: string) => {
      const cuerpo = respuestas(url);
      if (cuerpo instanceof Error) throw cuerpo;
      if (cuerpo === undefined) return new Response('{}', { status: 500 });
      return new Response(JSON.stringify(cuerpo), { status: 200 });
    });
    vi.stubGlobal('fetch', llamado);
    return llamado;
  }

  beforeEach(() => limpiarCacheMercado());

  it('pide sesión', async () => {
    expect((await pedir('/api/mercado', null)).status).toBe(401);
  });

  it('si todas las fuentes fallan no inventa nada', async () => {
    const c = await cuenta('gratis');
    fuente(() => new Error('sin red'));
    const { status, cuerpo } = await pedir('/api/mercado', c.cookie);
    expect(status).toBe(200);
    for (const s of [cuerpo.dolar, cuerpo.referencias, cuerpo.creditos.personales, cuerpo.creditos.prendarios, cuerpo.creditos.hipotecarios, cuerpo.plazoFijo, cuerpo.letras, cuerpo.fondos]) {
      expect(s.datos).toBeNull();
      expect(s.obtenidoEn).toBeNull();
    }
  });

  it('una fuente caída no afecta a las demás', async () => {
    const c = await cuenta('gratis');
    fuente((url) => (url.includes('dolarapi') ? DOLARES : undefined));
    const { cuerpo } = await pedir('/api/mercado', c.cookie);
    expect(cuerpo.dolar.datos[0]).toMatchObject({ casa: 'oficial', compra: 1520, venta: 1570 });
    expect(cuerpo.plazoFijo.datos).toBeNull();
  });

  it('guarda en caché y no le insiste a la fuente', async () => {
    const llamado = fuente(() => DOLARES);
    await dolar();
    await dolar();
    expect(llamado).toHaveBeenCalledTimes(1);
  });

  it('pedidos simultáneos comparten una sola consulta', async () => {
    const llamado = fuente(() => DOLARES);
    await Promise.all([dolar(), dolar(), dolar()]);
    expect(llamado).toHaveBeenCalledTimes(1);
  });

  it('si después falla, conserva el último dato y lo marca como desactualizado', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    fuente(() => DOLARES);
    const primero = await dolar();
    expect(primero.desactualizado).toBe(false);

    vi.setSystemTime(Date.now() + 10 * 60_000);
    fuente(() => new Error('caída'));
    const segundo = await dolar();
    expect(segundo.datos).toEqual(primero.datos);
    expect(segundo.desactualizado).toBe(true);
    expect(segundo.obtenidoEn).toBe(primero.obtenidoEn);
  });

  it('descarta filas inválidas de la fuente', async () => {
    fuente(() => [...DOLARES, { casa: 'x', nombre: 'Malo', compra: 'mucho', venta: -5, fechaActualizacion: '2026' }, null, 'basura']);
    expect((await dolar()).datos).toHaveLength(1);
  });

  it('una respuesta con otra forma no se muestra', async () => {
    fuente(() => ({ mensaje: 'mantenimiento' }));
    expect((await dolar()).datos).toBeNull();
  });

  it('plazo fijo: solo los 5 bancos principales, en porcentaje y ordenados', async () => {
    fuente(() => [
      { entidad: 'BANCO DE LA NACION ARGENTINA', tnaClientes: 0.17, tnaNoClientes: 0 },
      { entidad: 'BANCO DE GALICIA Y BUENOS AIRES S.A.', tnaClientes: 0.1925, tnaNoClientes: 0.1 },
      { entidad: 'BANCO BBVA ARGENTINA S.A.', tnaClientes: null },
      { entidad: 'BANCO BICA S.A.', tnaClientes: 0.24 },
      { entidad: 'BANCO PROVINCIA DEL NEUQUÉN S.A.', tnaClientes: 0.23 },
    ]);
    const { datos } = await plazoFijo();
    expect(datos?.map((f) => [f.entidad, Number(f.tnaClientes.toFixed(2)), f.tnaNoClientes])).toEqual([
      ['Banco Galicia', 19.25, 10],
      ['Banco Nación', 17, null],
    ]);
  });

  describe('depuración de créditos del BCRA', () => {
    const linea = (extra = {}) => ({
      descripcionEntidad: 'BANCO UNO',
      nombreCompleto: 'PERSONAL',
      denominacion: 'Pesos',
      tipoTasa: 'Fija',
      beneficiario: 'Todos los beneficiarios',
      tasaEfectivaAnualMaxima: 80,
      costoFinancieroEfectivoTotalMaximo: 90,
      plazoMaximoOtorgable: 60,
      montoMaximoOtorgable: 1000000,
      ingresoMinimoMensual: 100000,
      fechaInformacion: '2026-10-01',
      masInformacion: null,
      ...extra,
    });
    const HOY = '2026-11-04';

    it('saca líneas viejas, costos imposibles y dólares', () => {
      expect(depurarCreditos([linea({ fechaInformacion: '2020-05-04' })], HOY)).toEqual([]);
      expect(depurarCreditos([linea({ costoFinancieroEfectivoTotalMaximo: 72116 })], HOY)).toEqual([]);
      expect(depurarCreditos([linea({ costoFinancieroEfectivoTotalMaximo: 0 })], HOY)).toEqual([]);
      expect(depurarCreditos([linea({ denominacion: 'Dólares estadounidenses' })], HOY)).toEqual([]);
      expect(depurarCreditos([linea({ denominacion: null })], HOY)).toEqual([]);
    });

    it('conserva la de menor costo por entidad y beneficiario, y ordena', () => {
      const r = depurarCreditos(
        [
          linea({ costoFinancieroEfectivoTotalMaximo: 120 }),
          linea({ costoFinancieroEfectivoTotalMaximo: 90 }),
          linea({ beneficiario: 'Empleados públicos', costoFinancieroEfectivoTotalMaximo: 70 }),
          linea({ descripcionEntidad: 'BANCO DOS', costoFinancieroEfectivoTotalMaximo: 60 }),
        ],
        HOY,
      );
      expect(r.map((l) => [l.entidad, l.cft])).toEqual([
        ['BANCO DOS', 60],
        ['BANCO UNO', 70],
        ['BANCO UNO', 90],
      ]);
    });

    it('resume en los 5 bancos principales, con una línea cada uno', () => {
      const r = resumirCreditos(
        depurarCreditos(
          [
            linea({ descripcionEntidad: 'BANCO DE LA NACION ARGENTINA', costoFinancieroEfectivoTotalMaximo: 70 }),
            linea({ descripcionEntidad: 'BANCO DE LA NACION ARGENTINA', beneficiario: 'Empleados públicos', costoFinancieroEfectivoTotalMaximo: 40 }),
            linea({ descripcionEntidad: 'BANCO SANTANDER ARGENTINA S.A.', beneficiario: 'Empleados públicos', costoFinancieroEfectivoTotalMaximo: 80 }),
            linea({ descripcionEntidad: 'BANCO SANTANDER ARGENTINA S.A.', beneficiario: 'Monotributistas', costoFinancieroEfectivoTotalMaximo: 75 }),
            linea({ descripcionEntidad: 'BANCO BBVA ARGENTINA S.A.', denominacion: 'UVA', costoFinancieroEfectivoTotalMaximo: 10 }),
            linea({ descripcionEntidad: 'SANTANDER CONSUMER SA', costoFinancieroEfectivoTotalMaximo: 5 }),
            linea({ descripcionEntidad: 'BANCO PROVINCIA DEL NEUQUÉN SOCIEDAD ANÓNIMA', costoFinancieroEfectivoTotalMaximo: 5 }),
          ],
          HOY,
        ),
      );
      expect(r.map((b) => b.banco)).toEqual(BANCOS_PRINCIPALES.map((b) => b.nombre));
      const [nacion, galicia, santander, bbva, provincia] = r;
      // Prefiere la línea para todo público aunque haya otra más barata para un grupo puntual.
      expect(nacion.linea?.cft).toBe(70);
      expect(galicia.linea).toBeNull();
      expect(santander.linea).toMatchObject({ cft: 75, beneficiario: 'Monotributistas' });
      expect(bbva.linea).toMatchObject({ moneda: 'UVA', cft: 10 });
      expect(provincia.linea).toBeNull();
    });

    it('trata como UVA una línea con UVA en el nombre aunque la informen en pesos', () => {
      const r = depurarCreditos([linea({ nombreCompleto: 'PRESTAMO PERSONAL UVA', denominacion: 'Pesos' })], HOY);
      expect(r[0].moneda).toBe('UVA');
    });

    it('prefiere pesos antes que UVA en el mismo banco', () => {
      const r = resumirCreditos(
        depurarCreditos(
          [
            linea({ descripcionEntidad: 'BANCO DE LA NACION ARGENTINA', denominacion: 'UVA', costoFinancieroEfectivoTotalMaximo: 20 }),
            linea({ descripcionEntidad: 'BANCO DE LA NACION ARGENTINA', costoFinancieroEfectivoTotalMaximo: 60 }),
          ],
          HOY,
        ),
      );
      expect(r[0].linea).toMatchObject({ moneda: 'Pesos', cft: 60 });
    });

    it('limpia notas vacías y tolera campos faltantes', () => {
      const r = depurarCreditos([linea({ masInformacion: '0', plazoMaximoOtorgable: undefined, tipoTasa: null })], HOY);
      expect(r[0]).toMatchObject({ nota: null, plazoMeses: null, tasa: null });
    });
  });
});
