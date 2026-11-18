// Caja, vencimientos y simulador contra un servidor y PostgreSQL reales, con el rol de la app.
// Lo que entra y lo que sale ya no se cargan: salen de los movimientos. Solo la reserva se edita.

import { randomUUID } from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hoyArgentina } from '../server/acceso';
import { crearApp } from '../server/app';
import { conUsuario, pool } from '../server/db';
import { minimo, proyectar, sumarDias, type CompromisoCaja } from '../shared/motor';

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

const RESPUESTAS = {
  ocupacion: 'empleo',
  ingresos: 'fijos',
  hogar: 'solo',
  cuotas: 'pocas',
  registro_actual: 'planilla',
  objetivo: 'ahorrar',
  experiencia: 'alta',
};

async function pedir(ruta: string, cookie: string | null, metodo = 'GET', cuerpo?: unknown) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await res.text();
  return { status: res.status, cuerpo: texto ? JSON.parse(texto) : null, setCookie: res.headers.get('set-cookie') };
}

async function cuenta(plan: 'gratis' | 'intermedio' | 'full') {
  const alta = await pedir('/api/auth/registro', null, 'POST', {
    tipo: 'persona',
    nombre: 'Prueba',
    email: `caja-${randomUUID()}@ejemplo.test`,
    clave: 'clave-de-prueba-1',
    plan,
    respuestas: RESPUESTAS,
  });
  expect(alta.status).toBe(201);
  const cookie = alta.setCookie!.split(';')[0];
  const yo = (await pedir('/api/yo', cookie)).cuerpo;
  return { cookie, usuarioId: yo.usuario.id as string, espacio: `/api/espacios/${yo.espacios[0].id}`, espacioId: yo.espacios[0].id as string };
}

const dia = (n: number) => sumarDias(hoyArgentina(), n);

/** Un ingreso y un gasto por día durante 30 días, terminando hoy. */
async function historia(c: { cookie: string; espacio: string }, ingreso: number, gasto: number, extra: object[] = []) {
  const filas = Array.from({ length: 30 }, (_, k) => [
    { tipo: 'ingreso', monto: ingreso, concepto: 'Ventas', categoria: 'Ventas', fecha: dia(-k) },
    { tipo: 'egreso', monto: gasto, concepto: 'Gastos del día', categoria: 'Otros gastos', fecha: dia(-k) },
  ]).flat();
  const r = await pedir(`${c.espacio}/movimientos/importar`, c.cookie, 'POST', { filas: [...filas, ...extra] });
  expect(r.status).toBe(201);
}

const AGENDA: [number, 'pago' | 'cobro', number, string][] = [
  [1, 'pago', 650000, 'Alquiler'],
  [2, 'cobro', 420000, 'Tarjetas'],
  [3, 'pago', 780000, 'Molinos'],
  [5, 'pago', 2950000, 'Sueldos'],
];

/** La panadería del informe: vende $260.000 y gasta $25.000 por día, con sus pagos y cobros agendados. */
async function panaderia(plan: 'intermedio' | 'full' = 'full') {
  const c = await cuenta(plan);
  await historia(c, 260000, 25000);
  for (const [n, tipo, monto, concepto] of AGENDA) {
    const r = await pedir(`${c.espacio}/compromisos`, c.cookie, 'POST', { tipo, monto, concepto, categoria: 'Otros', fecha: dia(n), mensual: concepto === 'Alquiler' });
    expect(r.status).toBe(201);
  }
  return c;
}

const SALDO_PANADERIA = 30 * (260000 - 25000);

/** Lo que el motor calcula con los mismos datos, para comparar con lo que responde el servidor. */
function proyeccionEsperada(reserva = 0, agenda = AGENDA) {
  const compromisos: CompromisoCaja[] = agenda.map(([n, tipo, monto, concepto]) => ({ id: concepto, fecha: dia(n), monto: tipo === 'pago' ? -monto : monto, concepto, categoria: 'Otros', avisoDias: 2 }));
  return proyectar({ hoy: hoyArgentina(), saldo: SALDO_PANADERIA, reserva, margen: 235000 * 30, ventaDiaria: 260000, gastoDiario: 25000, compromisos, cantidadMovimientos: 60 });
}

const HORNO = { precio: 3600000, anticipo: 0, diaAnticipo: 1, cuotas: 12, tna: 48, diaCuota: 10, concepto: 'Horno' };

/** Un negocio al que le quedan exactamente $673.000 por mes, como en el informe. */
async function simulable() {
  const c = await cuenta('full');
  await historia(c, 100000, 100000, [{ tipo: 'ingreso', monto: 673000, concepto: 'Ventas', categoria: 'Ventas', fecha: dia(0) }]);
  return c;
}

describe('caja a 30 días', () => {
  it('sin movimientos no hay caja que proyectar', async () => {
    const c = await cuenta('gratis');
    expect((await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo).toEqual({ configurada: false });
  });

  it('lo que entra y lo que sale salen solos de los movimientos', async () => {
    const c = await panaderia();
    const { cuerpo } = await pedir(`${c.espacio}/caja`, c.cookie);
    expect(cuerpo.parametros).toEqual({ reserva: 0, ventaDiaria: 260000, gastoDiario: 25000, margen: 235000 * 30 });
    expect(cuerpo.diasHistoria).toBe(30);
    expect(cuerpo.saldo).toBe(SALDO_PANADERIA);
    expect(cuerpo.proyeccion).toEqual(proyeccionEsperada());
    expect(cuerpo.pagos7Dias).toBe(650000 + 780000 + 2950000);
    expect(cuerpo.cobros7Dias).toBe(420000);
  });

  it('la reserva es lo único que se edita: lo demás no se puede cambiar', async () => {
    const c = await panaderia();
    const r = await pedir(`${c.espacio}/parametros`, c.cookie, 'PUT', { reserva: 900000, ventaDiaria: 1, gastoDiario: 999999, margen: 1 });
    expect(r.status).toBe(204);
    const { cuerpo } = await pedir(`${c.espacio}/caja`, c.cookie);
    expect(cuerpo.parametros).toEqual({ reserva: 900000, ventaDiaria: 260000, gastoDiario: 25000, margen: 235000 * 30 });
  });

  it('una reserva por encima del peor día pasa el semáforo a amarillo y genera el aviso', async () => {
    const c = await panaderia();
    const peor = minimo(proyeccionEsperada()).v;
    await pedir(`${c.espacio}/parametros`, c.cookie, 'PUT', { reserva: peor + 100000 });
    const { cuerpo } = await pedir(`${c.espacio}/caja`, c.cookie);
    expect(cuerpo.nivel).toBe('amarillo');
    expect(cuerpo.alertas.some((a: any) => a.id.startsWith('bache-'))).toBe(true);
  });

  it('con menos de 5 movimientos da gris, sin afirmar que alcanza', async () => {
    const c = await cuenta('gratis');
    await pedir(`${c.espacio}/movimientos`, c.cookie, 'POST', { tipo: 'ingreso', monto: 1000, concepto: 'x', categoria: 'x', fecha: dia(0) });
    const { cuerpo } = await pedir(`${c.espacio}/caja`, c.cookie);
    expect(cuerpo.nivel).toBe('gris');
    expect(cuerpo.frase).not.toMatch(/Te alcanza/);
  });

  it('rechaza una reserva inválida', async () => {
    const c = await cuenta('gratis');
    for (const malo of [{ reserva: -1 }, { reserva: 'mucho' }, {}]) {
      expect((await pedir(`${c.espacio}/parametros`, c.cookie, 'PUT', malo)).status).toBe(400);
    }
  });

  it('el pago de un vencimiento baja el saldo pero no se suma al gasto diario, porque ya estaba agendado', async () => {
    const c = await panaderia();
    const alquiler = (await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos.find((x: any) => x.concepto === 'Alquiler');
    await pedir(`${c.espacio}/compromisos/${alquiler.id}/pagar`, c.cookie, 'POST');
    const { cuerpo } = await pedir(`${c.espacio}/caja`, c.cookie);
    expect(cuerpo.saldo).toBe(SALDO_PANADERIA - 650000);
    expect(cuerpo.parametros.gastoDiario).toBe(25000);
  });

  it('un gasto cargado a mano sí entra en el promedio', async () => {
    const c = await panaderia();
    await pedir(`${c.espacio}/movimientos`, c.cookie, 'POST', { tipo: 'egreso', monto: 300000, concepto: 'Horno usado', categoria: 'Otros', fecha: dia(0) });
    expect((await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo.parametros.gastoDiario).toBe(25000 + 300000 / 30);
  });
});

describe('gastos e ingresos cargados con fecha futura', () => {
  const programado = (n: number, monto = 500000, tipo = 'egreso') => ({ tipo, monto, concepto: 'Proveedor diferido', categoria: 'Insumos', fecha: dia(n) });

  it('antes de su día no bajan el saldo, pero entran en los pagos de la semana y en la proyección', async () => {
    const c = await panaderia();
    const antes = (await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo;
    expect((await pedir(`${c.espacio}/movimientos`, c.cookie, 'POST', programado(4))).status).toBe(201);
    const despues = (await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo;
    expect(despues.saldo).toBe(antes.saldo);
    expect(despues.pagos7Dias).toBe(antes.pagos7Dias + 500000);
    expect(despues.proyeccion[3]).toBe(antes.proyeccion[3]);
    expect(despues.proyeccion[4]).toBe(antes.proyeccion[4] - 500000);
    expect(despues.proyeccion[30]).toBe(antes.proyeccion[30] - 500000);
  });

  it('el día que llega se descuenta solo y deja de figurar como pendiente', async () => {
    const c = await panaderia();
    await pedir(`${c.espacio}/movimientos`, c.cookie, 'POST', programado(0));
    const caja = (await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo;
    expect(caja.saldo).toBe(SALDO_PANADERIA - 500000);
    const pendientes = (await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos;
    expect(pendientes.some((x: any) => x.concepto === 'Proveedor diferido')).toBe(false);
  });

  it('aparece en Vencimientos como programado, sin poder marcarlo pagado ni reprogramarlo', async () => {
    const c = await panaderia();
    // A 2 días, para que también salga el aviso de "vence pronto".
    const { id } = (await pedir(`${c.espacio}/movimientos`, c.cookie, 'POST', programado(2))).cuerpo;
    const lista = (await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos;
    const item = lista.find((x: any) => x.id === id);
    expect(item).toMatchObject({ origen: 'movimiento', tipo: 'pago', monto: 500000, dias: 2 });
    expect(lista.map((x: any) => x.fecha)).toEqual([...lista.map((x: any) => x.fecha)].sort());
    expect((await pedir(`${c.espacio}/compromisos/${id}/pagar`, c.cookie, 'POST')).status).toBe(404);
    expect((await pedir(`${c.espacio}/compromisos/${id}/reprogramar`, c.cookie, 'POST', { dias: 7 })).status).toBe(404);
    const aviso = (await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo.alertas.find((a: any) => a.id === `proximo-${id}`);
    expect(aviso?.acciones).toEqual([]);
  });

  it('borrarlo lo saca de la agenda y de la proyección', async () => {
    const c = await panaderia();
    const antes = (await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo;
    const { id } = (await pedir(`${c.espacio}/movimientos`, c.cookie, 'POST', programado(4))).cuerpo;
    expect((await pedir(`${c.espacio}/movimientos/${id}`, c.cookie, 'DELETE')).status).toBe(200);
    expect((await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo.proyeccion).toEqual(antes.proyeccion);
  });

  it('un ingreso programado también entra en la proyección', async () => {
    const c = await panaderia();
    const antes = (await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo;
    await pedir(`${c.espacio}/movimientos`, c.cookie, 'POST', programado(6, 300000, 'ingreso'));
    const despues = (await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo;
    expect(despues.proyeccion[6] - antes.proyeccion[6]).toBe(300000);
    expect(despues.pagos7Dias).toBe(antes.pagos7Dias);
    expect(despues.cobros7Dias).toBe(antes.cobros7Dias + 300000);
  });

  it('el gráfico del mes tiene lo que entró y salió cada día, sin lo programado', async () => {
    const c = await cuenta('full');
    const mov = (n: number, tipo: string, monto: number) => pedir(`${c.espacio}/movimientos`, c.cookie, 'POST', { tipo, monto, concepto: 'x', categoria: 'x', fecha: dia(n) });
    await mov(0, 'ingreso', 1000);
    await mov(0, 'egreso', 300);
    await mov(0, 'egreso', 200);
    await mov(2, 'egreso', 999);
    const { resumen } = (await pedir(`${c.espacio}/movimientos`, c.cookie)).cuerpo;
    expect(resumen.hoy).toBe(hoyArgentina());
    expect(resumen.diasMes).toEqual([{ fecha: dia(0), ingresos: 1000, egresos: 500 }]);
    expect(resumen.egresosMes).toBe(500);
  });

  it('los cobros de la semana no cuentan los atrasados ni los de más de 7 días', async () => {
    const c = await panaderia();
    const cobro = (n: number) => pedir(`${c.espacio}/compromisos`, c.cookie, 'POST', { tipo: 'cobro', monto: 1000, concepto: 'Cliente', categoria: 'Otros', fecha: dia(n) });
    await cobro(-2);
    await cobro(7);
    await cobro(8);
    expect((await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo.cobros7Dias).toBe(420000 + 1000);
  });

  it('no cuenta en lo que salió este mes hasta que llega su día', async () => {
    const c = await panaderia();
    const antes = (await pedir(`${c.espacio}/movimientos`, c.cookie)).cuerpo.resumen.egresosMes;
    await pedir(`${c.espacio}/movimientos`, c.cookie, 'POST', programado(1));
    expect((await pedir(`${c.espacio}/movimientos`, c.cookie)).cuerpo.resumen.egresosMes).toBe(antes);
  });

  it('en el plan Gratis también suma a los pagos de la semana', async () => {
    const c = await cuenta('gratis');
    await pedir(`${c.espacio}/movimientos`, c.cookie, 'POST', { tipo: 'ingreso', monto: 1000000, concepto: 'Ventas', categoria: 'Ventas', fecha: dia(-1) });
    await pedir(`${c.espacio}/movimientos`, c.cookie, 'POST', programado(2));
    const caja = (await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo;
    expect(caja.pagos7Dias).toBe(500000);
    expect(caja.saldo).toBe(1000000);
  });
});

describe('filtro de movimientos por fecha y tipo', () => {
  async function conMovimientos() {
    const c = await cuenta('full');
    for (const [n, tipo, monto] of [[-40, 'ingreso', 1000], [-10, 'egreso', 200], [-3, 'ingreso', 500], [0, 'egreso', 50], [5, 'egreso', 70]] as const) {
      await pedir(`${c.espacio}/movimientos`, c.cookie, 'POST', { tipo, monto, concepto: `M${n}`, categoria: 'x', fecha: dia(n) });
    }
    return c;
  }
  const filtrar = (c: { cookie: string; espacio: string }, q: string) => pedir(`${c.espacio}/movimientos?${q}`, c.cookie);

  it('sin filtro trae todo, con totales', async () => {
    const c = await conMovimientos();
    const { cuerpo } = await filtrar(c, '');
    expect(cuerpo.movimientos).toHaveLength(5);
    expect(cuerpo.filtro).toEqual({ cantidad: 5, ingresos: 1500, egresos: 320, recortado: false });
  });

  it('filtra por rango de fechas, con los dos extremos incluidos', async () => {
    const c = await conMovimientos();
    const { cuerpo } = await filtrar(c, `desde=${dia(-10)}&hasta=${dia(0)}`);
    expect(cuerpo.movimientos.map((m: any) => m.concepto).sort()).toEqual(['M-10', 'M-3', 'M0']);
    expect(cuerpo.filtro).toMatchObject({ cantidad: 3, ingresos: 500, egresos: 250 });
  });

  it('filtra solo desde o solo hasta, y por tipo', async () => {
    const c = await conMovimientos();
    expect((await filtrar(c, `desde=${dia(1)}`)).cuerpo.movimientos.map((m: any) => m.concepto)).toEqual(['M5']);
    expect((await filtrar(c, `hasta=${dia(-11)}`)).cuerpo.movimientos.map((m: any) => m.concepto)).toEqual(['M-40']);
    const gastos = (await filtrar(c, 'tipo=egreso')).cuerpo;
    expect(gastos.movimientos.every((m: any) => m.tipo === 'egreso')).toBe(true);
    expect(gastos.filtro).toMatchObject({ cantidad: 3, ingresos: 0, egresos: 320 });
  });

  it('el resumen de la caja no cambia con el filtro', async () => {
    const c = await conMovimientos();
    const sin = (await filtrar(c, '')).cuerpo.resumen;
    expect((await filtrar(c, 'tipo=ingreso')).cuerpo.resumen).toEqual(sin);
  });

  it('rechaza fechas inválidas, un rango al revés y tipos que no existen', async () => {
    const c = await conMovimientos();
    for (const q of ['desde=ayer', 'hasta=2026-13-40', `desde=${dia(0)}&hasta=${dia(-1)}`, 'tipo=robo', "tipo=ingreso' OR 1=1--"]) {
      expect((await filtrar(c, q)).status, q).toBe(400);
    }
  });

  it('el filtro no sirve para mirar el espacio de otro', async () => {
    const ana = await conMovimientos();
    const beto = await cuenta('full');
    const r = await pedir(`${ana.espacio}/movimientos?desde=${dia(-100)}`, beto.cookie);
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.cuerpo)).not.toContain('M-40');
  });
});

describe('qué incluye cada plan lo decide el servidor', () => {
  it('Gratis usa la caja base, pero no vencimientos, alertas, simulador ni escenarios', async () => {
    const c = await cuenta('gratis');
    await pedir(`${c.espacio}/movimientos`, c.cookie, 'POST', { tipo: 'ingreso', monto: 1000, concepto: 'x', categoria: 'x', fecha: dia(0) });
    const caja = await pedir(`${c.espacio}/caja`, c.cookie);
    expect(caja.status).toBe(200);
    expect(caja.cuerpo.alertas).toBeNull();

    const bloqueados = [
      await pedir(`${c.espacio}/caja?escenario=estres`, c.cookie),
      await pedir(`${c.espacio}/compromisos`, c.cookie),
      await pedir(`${c.espacio}/compromisos`, c.cookie, 'POST', { tipo: 'pago', monto: 1, concepto: 'x', categoria: 'x', fecha: dia(1) }),
      await pedir(`${c.espacio}/simulador`, c.cookie, 'POST', HORNO),
      await pedir(`${c.espacio}/simulador/guardar`, c.cookie, 'POST', HORNO),
    ];
    for (const r of bloqueados) {
      expect(r.status).toBe(403);
      expect(r.cuerpo.codigo).toBe('modulo_no_incluido');
    }
    expect(bloqueados[0].cuerpo.planNecesario).toBe('Full');
    expect(bloqueados[1].cuerpo.planNecesario).toBe('Intermedio');
  });

  it('Intermedio usa vencimientos, alertas y simulador, pero no escenarios', async () => {
    const c = await panaderia('intermedio');
    const caja = await pedir(`${c.espacio}/caja`, c.cookie);
    expect(Array.isArray(caja.cuerpo.alertas)).toBe(true);
    expect((await pedir(`${c.espacio}/simulador`, c.cookie, 'POST', HORNO)).status).toBe(200);
    expect((await pedir(`${c.espacio}/caja?escenario=estres`, c.cookie)).status).toBe(403);
    expect((await pedir(`${c.espacio}/caja?escenario=conservador`, c.cookie)).status).toBe(403);
  });

  it('Full usa los escenarios y el estrés empeora la caja', async () => {
    const c = await panaderia('full');
    const base = await pedir(`${c.espacio}/caja`, c.cookie);
    const estres = await pedir(`${c.espacio}/caja?escenario=estres`, c.cookie);
    expect(estres.status).toBe(200);
    expect(estres.cuerpo.minimo.v).toBeLessThan(base.cuerpo.minimo.v);
  });
});

describe('vencimientos', () => {
  it('pagar crea el movimiento, baja el saldo, agenda el próximo mes y no se repite', async () => {
    const c = await panaderia();
    const antes = await pedir(`${c.espacio}/compromisos`, c.cookie);
    const alquiler = antes.cuerpo.compromisos.find((x: any) => x.concepto === 'Alquiler');
    expect(alquiler.saldoEseDia).toBe(SALDO_PANADERIA + 235000 - 650000);

    expect((await pedir(`${c.espacio}/compromisos/${alquiler.id}/pagar`, c.cookie, 'POST')).status).toBe(204);

    const despues = (await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos.filter((x: any) => x.concepto === 'Alquiler');
    expect(despues).toHaveLength(1);
    expect(despues[0].id).not.toBe(alquiler.id);
    expect(despues[0].dias).toBeGreaterThanOrEqual(28);
    expect(despues[0].mensual).toBe(true);

    expect((await pedir(`${c.espacio}/compromisos/${alquiler.id}/pagar`, c.cookie, 'POST')).status).toBe(404);
    const movimientos = (await pedir(`${c.espacio}/movimientos`, c.cookie)).cuerpo.movimientos.filter((m: any) => m.concepto === 'Alquiler');
    expect(movimientos).toHaveLength(1);
  });

  it('dos pagos simultáneos del mismo compromiso registran uno solo', async () => {
    const c = await panaderia();
    const lista = (await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos;
    const molinos = lista.find((x: any) => x.concepto === 'Molinos');
    const estados = (await Promise.all([1, 2, 3].map(() => pedir(`${c.espacio}/compromisos/${molinos.id}/pagar`, c.cookie, 'POST')))).map((r) => r.status);
    expect(estados.filter((s) => s === 204)).toHaveLength(1);
    const movimientos = (await pedir(`${c.espacio}/movimientos`, c.cookie)).cuerpo.movimientos.filter((m: any) => m.concepto === 'Molinos');
    expect(movimientos).toHaveLength(1);
  });

  it('un cobro registrado suma al saldo', async () => {
    const c = await panaderia();
    const tarjetas = (await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos.find((x: any) => x.concepto === 'Tarjetas');
    await pedir(`${c.espacio}/compromisos/${tarjetas.id}/pagar`, c.cookie, 'POST');
    expect((await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo.saldo).toBe(SALDO_PANADERIA + 420000);
  });

  it('reprogramar mueve la fecha y borrar lo saca de la caja', async () => {
    const c = await panaderia();
    const lista = (await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos;
    const sueldos = lista.find((x: any) => x.concepto === 'Sueldos');
    expect((await pedir(`${c.espacio}/compromisos/${sueldos.id}/reprogramar`, c.cookie, 'POST', { dias: 7 })).status).toBe(204);
    const movido = (await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos.find((x: any) => x.id === sueldos.id);
    expect(movido.fecha).toBe(dia(12));
    expect((await pedir(`${c.espacio}/compromisos/${sueldos.id}/reprogramar`, c.cookie, 'POST', { dias: 0 })).status).toBe(400);

    const antes = (await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo.proyeccion[30];
    expect((await pedir(`${c.espacio}/compromisos/${sueldos.id}`, c.cookie, 'DELETE')).status).toBe(204);
    expect((await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo.proyeccion[30] - antes).toBe(2950000);
  });

  it('borrar el movimiento de un pago lo vuelve a pendiente, saca el próximo mensual y deja registro', async () => {
    const c = await panaderia();
    const alquiler = (await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos.find((x: any) => x.concepto === 'Alquiler');
    const saldoAntes = (await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo.saldo;
    await pedir(`${c.espacio}/compromisos/${alquiler.id}/pagar`, c.cookie, 'POST');
    const pago = (await pedir(`${c.espacio}/movimientos`, c.cookie)).cuerpo.movimientos.find((m: any) => m.concepto === 'Alquiler');
    expect((await pedir(`${c.espacio}/compromisos/historial`, c.cookie)).cuerpo.historial.map((h: any) => [h.id, h.estado])).toContainEqual([alquiler.id, 'pagado']);

    const borrado = await pedir(`${c.espacio}/movimientos/${pago.id}`, c.cookie, 'DELETE');
    expect(borrado.cuerpo).toEqual({ volvioAPendiente: true, concepto: 'Alquiler' });

    // Vuelve a la agenda tal cual, sin el próximo mes que se había agendado solo.
    const agenda = (await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos.filter((x: any) => x.concepto === 'Alquiler');
    expect(agenda.map((x: any) => x.id)).toEqual([alquiler.id]);
    expect((await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo.saldo).toBe(saldoAntes);
    expect((await pedir(`${c.espacio}/compromisos/historial`, c.cookie)).cuerpo.historial.find((h: any) => h.id === alquiler.id)).toBeUndefined();

    // Y el movimiento borrado queda guardado.
    const eliminados = (await pedir(`${c.espacio}/movimientos-eliminados`, c.cookie)).cuerpo.eliminados;
    expect(eliminados[0]).toMatchObject({ id: pago.id, concepto: 'Alquiler', deAgenda: true });
  });

  it('restaurar el movimiento borrado vuelve a marcar el pago como hecho', async () => {
    const c = await panaderia();
    const alquiler = (await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos.find((x: any) => x.concepto === 'Alquiler');
    await pedir(`${c.espacio}/compromisos/${alquiler.id}/pagar`, c.cookie, 'POST');
    const saldoPagado = (await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo.saldo;
    const pago = (await pedir(`${c.espacio}/movimientos`, c.cookie)).cuerpo.movimientos.find((m: any) => m.concepto === 'Alquiler');
    await pedir(`${c.espacio}/movimientos/${pago.id}`, c.cookie, 'DELETE');

    expect((await pedir(`${c.espacio}/movimientos-eliminados/${pago.id}/restaurar`, c.cookie, 'POST')).status).toBe(204);
    expect((await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo.saldo).toBe(saldoPagado);
    const agenda = (await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos.filter((x: any) => x.concepto === 'Alquiler');
    expect(agenda).toHaveLength(1);
    expect(agenda[0].id).not.toBe(alquiler.id);
    expect((await pedir(`${c.espacio}/movimientos-eliminados`, c.cookie)).cuerpo.eliminados.find((e: any) => e.id === pago.id)).toBeUndefined();
  });

  it('no restaura un pago que ya se volvió a registrar, para no contarlo dos veces', async () => {
    const c = await panaderia();
    const molinos = (await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos.find((x: any) => x.concepto === 'Molinos');
    await pedir(`${c.espacio}/compromisos/${molinos.id}/pagar`, c.cookie, 'POST');
    const pago = (await pedir(`${c.espacio}/movimientos`, c.cookie)).cuerpo.movimientos.find((m: any) => m.concepto === 'Molinos');
    await pedir(`${c.espacio}/movimientos/${pago.id}`, c.cookie, 'DELETE');
    await pedir(`${c.espacio}/compromisos/${molinos.id}/pagar`, c.cookie, 'POST');
    expect((await pedir(`${c.espacio}/movimientos-eliminados/${pago.id}/restaurar`, c.cookie, 'POST')).status).toBe(409);
    expect((await pedir(`${c.espacio}/movimientos`, c.cookie)).cuerpo.movimientos.filter((m: any) => m.concepto === 'Molinos')).toHaveLength(1);
  });

  it('deshacer un pago desde el historial lo vuelve a pendiente y devuelve la plata', async () => {
    const c = await panaderia();
    const tarjetas = (await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos.find((x: any) => x.concepto === 'Tarjetas');
    await pedir(`${c.espacio}/compromisos/${tarjetas.id}/pagar`, c.cookie, 'POST');
    expect((await pedir(`${c.espacio}/compromisos/${tarjetas.id}/deshacer-pago`, c.cookie, 'POST')).status).toBe(204);
    expect((await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo.saldo).toBe(SALDO_PANADERIA);
    expect((await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos.find((x: any) => x.id === tarjetas.id)).toBeDefined();
    expect((await pedir(`${c.espacio}/compromisos/${tarjetas.id}/deshacer-pago`, c.cookie, 'POST')).status).toBe(404);
  });

  it('eliminar de la agenda lo pasa al historial y se puede volver a agendar', async () => {
    const c = await panaderia();
    const sueldos = (await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos.find((x: any) => x.concepto === 'Sueldos');
    await pedir(`${c.espacio}/compromisos/${sueldos.id}`, c.cookie, 'DELETE');
    const historial = (await pedir(`${c.espacio}/compromisos/historial`, c.cookie)).cuerpo.historial;
    expect(historial.find((h: any) => h.id === sueldos.id)).toMatchObject({ estado: 'anulado', concepto: 'Sueldos' });
    expect((await pedir(`${c.espacio}/compromisos/${sueldos.id}/restaurar`, c.cookie, 'POST')).status).toBe(204);
    expect((await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos.find((x: any) => x.id === sueldos.id)).toBeDefined();
  });

  it('un movimiento común borrado se puede restaurar', async () => {
    const c = await panaderia();
    const nuevo = await pedir(`${c.espacio}/movimientos`, c.cookie, 'POST', { tipo: 'egreso', monto: 1234, concepto: 'Prueba borrar', categoria: 'Otros gastos', fecha: dia(0) });
    const id = nuevo.cuerpo.movimiento?.id ?? nuevo.cuerpo.id;
    const saldo = (await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo.saldo;
    expect((await pedir(`${c.espacio}/movimientos/${id}`, c.cookie, 'DELETE')).cuerpo.volvioAPendiente).toBe(false);
    expect((await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo.saldo).toBe(saldo + 1234);
    expect((await pedir(`${c.espacio}/movimientos-eliminados/${id}/restaurar`, c.cookie, 'POST')).status).toBe(204);
    expect((await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo.saldo).toBe(saldo);
  });

  it('valida lo que se carga', async () => {
    const c = await panaderia();
    const bueno = { tipo: 'pago', monto: 10, concepto: 'x', categoria: 'x', fecha: dia(1) };
    for (const malo of [{ monto: 0 }, { monto: 1.5 }, { tipo: 'robo' }, { fecha: 'mañana' }, { concepto: '' }, { avisoDias: 99 }]) {
      expect((await pedir(`${c.espacio}/compromisos`, c.cookie, 'POST', { ...bueno, ...malo })).status).toBe(400);
    }
  });
});

describe('simulador', () => {
  it('sin movimientos pide cargarlos', async () => {
    const c = await cuenta('full');
    const r = await pedir(`${c.espacio}/simulador`, c.cookie, 'POST', HORNO);
    expect(r.status).toBe(409);
    expect(r.cuerpo.codigo).toBe('sin_parametros');
  });

  it('da las cifras del horno con lo que le queda por mes según sus movimientos', async () => {
    const c = await simulable();
    expect((await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo.parametros.margen).toBeCloseTo(673000, 6);
    const rojo = (await pedir(`${c.espacio}/simulador`, c.cookie, 'POST', HORNO)).cuerpo;
    expect(Math.round(rojo.cuota)).toBe(383588);
    expect(Math.round(rojo.proporcion * 100)).toBe(57);
    expect(rojo.nivel).toBe('rojo');
    const amarillo = (await pedir(`${c.espacio}/simulador`, c.cookie, 'POST', { ...HORNO, cuotas: 24 })).cuerpo;
    expect(Math.round(amarillo.cuota)).toBe(236113);
    expect(amarillo.nivel).toBe('amarillo');
    const verde = (await pedir(`${c.espacio}/simulador`, c.cookie, 'POST', { ...HORNO, anticipo: 1800000, diaAnticipo: 45 })).cuerpo;
    expect(Math.round(verde.cuota)).toBe(191794);
    expect(verde.nivel).toBe('verde');
    expect((await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos).toHaveLength(0);
  });

  it('rechaza entradas absurdas', async () => {
    const c = await simulable();
    for (const malo of [{ cuotas: 7 }, { anticipo: 3600000 }, { tna: -1 }, { precio: 0 }, { diaCuota: 0 }, { tna: undefined }]) {
      expect((await pedir(`${c.espacio}/simulador`, c.cookie, 'POST', { ...HORNO, ...malo })).status).toBe(400);
    }
  });

  it('guardar en rojo exige confirmación del lado del servidor', async () => {
    const c = await simulable();
    const sinConfirmar = await pedir(`${c.espacio}/simulador/guardar`, c.cookie, 'POST', HORNO);
    expect(sinConfirmar.status).toBe(409);
    expect(sinConfirmar.cuerpo.codigo).toBe('requiere_confirmacion');
    expect((await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos).toHaveLength(0);

    const confirmado = await pedir(`${c.espacio}/simulador/guardar`, c.cookie, 'POST', { ...HORNO, confirmarRojo: true });
    expect(confirmado.cuerpo.creados).toBe(12);
    const cuotas = (await pedir(`${c.espacio}/compromisos`, c.cookie)).cuerpo.compromisos.filter((x: any) => x.concepto.startsWith('Horno'));
    expect(cuotas).toHaveLength(12);
    expect(cuotas[0].monto).toBe(383588);
    expect(cuotas[0].dias).toBe(10);
    expect(cuotas[1].dias).toBe(40);
  });

  it('guardar con anticipo agrega el anticipo y lo guardado cambia la caja', async () => {
    const c = await simulable();
    const antes = (await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo.proyeccion[30];
    const r = await pedir(`${c.espacio}/simulador/guardar`, c.cookie, 'POST', { ...HORNO, anticipo: 1800000, diaAnticipo: 20, confirmarRojo: true });
    expect(r.cuerpo.creados).toBe(13);
    const despues = (await pedir(`${c.espacio}/caja`, c.cookie)).cuerpo.proyeccion[30];
    expect(antes - despues).toBeCloseTo(1800000 + 191794, 6);
  });
});

describe('aislamiento en caja, vencimientos y simulador', () => {
  it('ningún pedido llega al espacio de otro usuario', async () => {
    const ana = await panaderia();
    const beto = await cuenta('full');
    const compromisoDeAna = (await pedir(`${ana.espacio}/compromisos`, ana.cookie)).cuerpo.compromisos[0].id;
    const antes = await pedir(`${ana.espacio}/caja`, ana.cookie);

    const intentos = [
      await pedir(`${ana.espacio}/caja`, beto.cookie),
      await pedir(`${ana.espacio}/caja?escenario=estres`, beto.cookie),
      await pedir(`${ana.espacio}/parametros`, beto.cookie, 'PUT', { reserva: 1 }),
      await pedir(`${ana.espacio}/compromisos`, beto.cookie),
      await pedir(`${ana.espacio}/compromisos`, beto.cookie, 'POST', { tipo: 'pago', monto: 1, concepto: 'x', categoria: 'x', fecha: dia(1) }),
      await pedir(`${ana.espacio}/compromisos/${compromisoDeAna}/pagar`, beto.cookie, 'POST'),
      await pedir(`${ana.espacio}/compromisos/${compromisoDeAna}/reprogramar`, beto.cookie, 'POST', { dias: 7 }),
      await pedir(`${ana.espacio}/compromisos/${compromisoDeAna}`, beto.cookie, 'DELETE'),
      await pedir(`${ana.espacio}/simulador`, beto.cookie, 'POST', HORNO),
      await pedir(`${ana.espacio}/simulador/guardar`, beto.cookie, 'POST', { ...HORNO, confirmarRojo: true }),
      // Por su propio espacio, apuntando al compromiso ajeno.
      await pedir(`${beto.espacio}/compromisos/${compromisoDeAna}/pagar`, beto.cookie, 'POST'),
      await pedir(`${beto.espacio}/compromisos/${compromisoDeAna}/reprogramar`, beto.cookie, 'POST', { dias: 7 }),
      await pedir(`${beto.espacio}/compromisos/${compromisoDeAna}`, beto.cookie, 'DELETE'),
    ];
    for (const r of intentos) {
      expect(r.status).toBe(404);
      expect(JSON.stringify(r.cuerpo)).not.toMatch(/Alquiler|7050000/);
    }
    expect(await pedir(`${ana.espacio}/caja`, ana.cookie)).toEqual(antes);
  });

  it('un espacio ajeno responde 404 antes de revelar cuál es su plan', async () => {
    const ana = await cuenta('full');
    const beto = await cuenta('gratis');
    expect((await pedir(`${ana.espacio}/compromisos`, beto.cookie)).status).toBe(404);
  });

  it('sin sesión no se accede a nada', async () => {
    const ana = await panaderia();
    for (const r of [
      await pedir(`${ana.espacio}/caja`, null),
      await pedir(`${ana.espacio}/compromisos`, null),
      await pedir(`${ana.espacio}/parametros`, null, 'PUT', { reserva: 1 }),
      await pedir(`${ana.espacio}/simulador`, null, 'POST', HORNO),
    ]) {
      expect(r.status).toBe(401);
    }
  });

  it('RLS oculta y protege las tablas nuevas aunque falle el código de la ruta', async () => {
    const ana = await panaderia();
    await pedir(`${ana.espacio}/parametros`, ana.cookie, 'PUT', { reserva: 5 });
    const beto = await cuenta('full');
    for (const tabla of ['parametros_caja', 'compromisos']) {
      expect((await conUsuario(beto.usuarioId, (c) => c.query(`SELECT 1 FROM ${tabla} WHERE espacio_id = $1`, [ana.espacioId]))).rowCount, tabla).toBe(0);
      expect((await pool.query(`SELECT 1 FROM ${tabla}`)).rowCount, tabla).toBe(0);
    }
    await expect(
      conUsuario(beto.usuarioId, (c) =>
        c.query(`INSERT INTO compromisos (espacio_id, tipo, monto_ars, concepto, categoria, fecha) VALUES ($1, 'pago', 1, 'x', 'x', now())`, [ana.espacioId]),
      ),
    ).rejects.toThrow(/row-level security|seguridad de registros/i);
    await expect(conUsuario(beto.usuarioId, (c) => c.query(`INSERT INTO parametros_caja (espacio_id, reserva) VALUES ($1, 0)`, [ana.espacioId]))).rejects.toThrow(
      /row-level security|seguridad de registros/i,
    );
    const alterados = await conUsuario(beto.usuarioId, (c) => c.query(`UPDATE compromisos SET estado = 'pagado' WHERE espacio_id = $1`, [ana.espacioId]));
    expect(alterados.rowCount).toBe(0);
    const borrados = await conUsuario(beto.usuarioId, (c) => c.query(`DELETE FROM compromisos WHERE espacio_id = $1`, [ana.espacioId]));
    expect(borrados.rowCount).toBe(0);
  });

  it('el rol de la app no puede mover un compromiso a otro espacio', async () => {
    const ana = await panaderia();
    await expect(conUsuario(ana.usuarioId, (c) => c.query(`UPDATE compromisos SET espacio_id = espacio_id`))).rejects.toThrow();
    await expect(conUsuario(ana.usuarioId, (c) => c.query(`UPDATE compromisos SET monto_ars = 1`))).rejects.toThrow();
  });
});
