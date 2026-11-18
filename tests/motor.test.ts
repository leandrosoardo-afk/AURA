// Las cifras esperadas son las de la sección 2.5 del informe y las pruebas de la versión anterior.

import { describe, expect, it } from 'vitest';
import { alertas, amortizar, cuotaFrancesa, evaluar, fraseRespuesta, minimo, proyectar, simular, sumarDias, type CompromisoCaja, type DatosCaja } from '../shared/motor';

const HOY = '2026-11-04';

function compromiso(dias: number, monto: number, concepto: string, categoria = 'Otros'): CompromisoCaja {
  return { id: `${concepto}-${dias}`, fecha: sumarDias(HOY, dias), monto, concepto, categoria, avisoDias: 2 };
}

const PANADERIA: DatosCaja = {
  hoy: HOY,
  saldo: 3800000,
  reserva: 800000,
  margen: 673000,
  ventaDiaria: 260000,
  gastoDiario: 25000,
  cantidadMovimientos: 8,
  compromisos: [
    compromiso(1, -650000, 'Alquiler del local', 'Alquiler'),
    compromiso(2, 420000, 'Liquidación de tarjetas', 'Ventas'),
    compromiso(3, -780000, 'Molinos Sur', 'Insumos'),
    compromiso(5, -2950000, 'Sueldos', 'Sueldos'),
    compromiso(7, -460000, 'Monotributo', 'Impuestos'),
    compromiso(10, -310000, 'Luz y gas', 'Servicios'),
    compromiso(12, 380000, 'Liquidación de tarjetas', 'Ventas'),
    compromiso(15, -520000, 'Lácteos', 'Insumos'),
    compromiso(18, -780000, 'Molinos Sur', 'Insumos'),
    compromiso(22, 400000, 'Liquidación de tarjetas', 'Ventas'),
    compromiso(25, -180000, 'Internet y seguro', 'Servicios'),
    compromiso(28, -900000, 'Insumos varios', 'Insumos'),
  ],
};

const HORNO = { precio: 3600000, anticipo: 0, diaAnticipo: 1, cuotas: 12, tna: 48, diaCuota: 10 };

describe('caja proyectada', () => {
  it('el peor día de la panadería es el día 5, con $1.015.000, en verde', () => {
    const p = proyectar(PANADERIA);
    expect(p).toHaveLength(31);
    expect(p[0]).toBe(3800000);
    expect(minimo(p)).toEqual({ v: 1015000, d: 5 });
    expect(evaluar(PANADERIA, p).nivel).toBe('verde');
  });

  it('un pago de $400.000 en 3 días baja el mínimo a $615.000 y pasa a amarillo', () => {
    const datos = { ...PANADERIA, compromisos: [...PANADERIA.compromisos, compromiso(3, -400000, 'Levadura y manteca', 'Insumos')] };
    const p = proyectar(datos);
    const ev = evaluar(datos, p);
    expect(minimo(p)).toEqual({ v: 615000, d: 5 });
    expect(ev.nivel).toBe('amarillo');
    expect(fraseRespuesta(datos, ev)).toMatch(/185\.000 debajo de tu reserva/);
  });

  it('caja negativa da rojo y dice cuánto falta', () => {
    const datos = { ...PANADERIA, saldo: 100000 };
    const ev = evaluar(datos, proyectar(datos));
    expect(ev.nivel).toBe('rojo');
    expect(fraseRespuesta(datos, ev)).toMatch(/^No te alcanza/);
  });

  it('con menos de 5 movimientos da gris, aunque los números se vean bien', () => {
    const datos = { ...PANADERIA, cantidadMovimientos: 4 };
    const ev = evaluar(datos, proyectar(datos));
    expect(ev.nivel).toBe('gris');
    expect(ev.razones[0]).toContain('1 movimiento más');
  });

  it('los escenarios bajan las ventas y atrasan los cobros', () => {
    const base = minimo(proyectar(PANADERIA, 'base')).v;
    const conservador = minimo(proyectar(PANADERIA, 'conservador')).v;
    const estres = minimo(proyectar(PANADERIA, 'estres')).v;
    expect(conservador).toBeLessThan(base);
    expect(estres).toBeLessThan(conservador);
  });

  it('un pago vencido sale mañana y un cobro atrasado no se cuenta', () => {
    const datos: DatosCaja = { ...PANADERIA, ventaDiaria: 0, gastoDiario: 0, saldo: 1000, compromisos: [compromiso(-3, -100, 'Vencido'), compromiso(-3, 500, 'Atrasado')] };
    const p = proyectar(datos);
    expect(p[0]).toBe(1000);
    expect(p[1]).toBe(900);
    expect(p[30]).toBe(900);
  });

  it('un cobro que vence hoy entra mañana en la proyección', () => {
    const datos: DatosCaja = { ...PANADERIA, ventaDiaria: 0, gastoDiario: 0, saldo: 1000, compromisos: [compromiso(0, 500, 'Hoy')] };
    expect(proyectar(datos)[1]).toBe(1500);
    expect(proyectar(datos, 'estres')[10]).toBe(1500);
    expect(proyectar(datos, 'estres')[9]).toBe(1000);
  });
});

describe('simulador: horno de $3.600.000 al 48% TNA', () => {
  it('12 cuotas: $383.588, 57% del margen, rojo', () => {
    const r = simular(PANADERIA, HORNO);
    expect(Math.round(r.cuota)).toBe(383588);
    expect(Math.round(r.proporcion! * 100)).toBe(57);
    expect(r.nivel).toBe('rojo');
    expect(r.razones.join()).toContain('57%');
    expect(r.alternativa).toContain('anticipo');
  });

  it('24 cuotas: $236.113, 35% del margen, amarillo', () => {
    const r = simular(PANADERIA, { ...HORNO, cuotas: 24 });
    expect(Math.round(r.cuota)).toBe(236113);
    expect(Math.round(r.proporcion! * 100)).toBe(35);
    expect(r.nivel).toBe('amarillo');
  });

  it('anticipo de $1.800.000 a 45 días y 12 cuotas: $191.794, 28%, verde', () => {
    const r = simular(PANADERIA, { ...HORNO, anticipo: 1800000, diaAnticipo: 45 });
    expect(Math.round(r.cuota)).toBe(191794);
    expect(Math.round(r.proporcion! * 100)).toBe(28);
    expect(r.nivel).toBe('verde');
    expect(r.alternativa).toBeNull();
  });

  it('un anticipo dentro de los 30 días sí baja la caja desde ese día', () => {
    const r = simular(PANADERIA, { ...HORNO, anticipo: 1800000, diaAnticipo: 3 });
    expect(r.sinOperacion[2] - r.conOperacion[2]).toBe(0);
    expect(r.sinOperacion[3] - r.conOperacion[3]).toBe(1800000);
    expect(r.sinOperacion[30] - r.conOperacion[30]).toBeCloseTo(1800000 + r.cuota * 1, 5);
  });

  it('la comparación coincide con simular cada plazo', () => {
    const r = simular(PANADERIA, HORNO);
    expect(r.comparacion.find((c) => c.cuotas === 24)?.nivel).toBe('amarillo');
    expect(Math.round(r.comparacion.find((c) => c.cuotas === 12)!.cuota)).toBe(383588);
    expect(r.comparacion.map((c) => c.cuotas)).toEqual([3, 6, 12, 18, 24]);
  });

  it('la amortización cancela el capital y suma el total', () => {
    const filas = amortizar(3600000, 12, 48);
    expect(filas).toHaveLength(12);
    expect(filas[11].saldo).toBe(0);
    expect(filas.reduce((s, f) => s + f.capital, 0)).toBeCloseTo(3600000, 2);
    expect(filas[0].interes).toBeCloseTo(144000, 5);
  });

  it('sin interés, la cuota es el capital dividido por las cuotas', () => {
    expect(cuotaFrancesa(1200000, 12, 0)).toBe(100000);
    expect(amortizar(1200000, 12, 0)[11].saldo).toBe(0);
  });

  it('sin margen no da verde: cualquier cuota es un riesgo', () => {
    const r = simular({ ...PANADERIA, margen: 0 }, { ...HORNO, precio: 1000 });
    expect(r.nivel).toBe('rojo');
    expect(r.proporcion).toBeNull();
  });
});

describe('alertas', () => {
  it('avisa el bache, explica la causa y propone mover un pago que no sea sueldos', () => {
    const datos = { ...PANADERIA, compromisos: [...PANADERIA.compromisos, compromiso(3, -400000, 'Levadura', 'Insumos')] };
    const bache = alertas(datos, proyectar(datos)).find((a) => a.id.startsWith('bache-'))!;
    expect(bache.nivel).toBe('amarillo');
    expect(bache.detalle).toContain('Sueldos');
    const mover = bache.acciones.find((a) => a.tipo === 'reprogramar')!;
    expect(mover.compromisoId).toBe('Molinos Sur-3');
  });

  it('avisa vencidos, próximos vencimientos y cobros atrasados', () => {
    const datos = { ...PANADERIA, compromisos: [compromiso(-1, -100, 'Luz'), compromiso(1, -100, 'Gas'), compromiso(-2, 300, 'Cliente')] };
    const ids = alertas(datos, proyectar(datos)).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['vencido-Luz--1', 'proximo-Gas-1', 'atrasado-Cliente--2']));
  });

  it('un gasto programado no ofrece marcarlo pagado ni moverlo: se descuenta solo', () => {
    // A 2 días: dentro del aviso de próximos vencimientos y antes del peor día.
    const programado = { ...compromiso(2, -400000, 'Proveedor', 'Insumos'), automatico: true };
    const datos = { ...PANADERIA, compromisos: [...PANADERIA.compromisos, programado] };
    const lista = alertas(datos, proyectar(datos));
    expect(lista.find((a) => a.id === 'proximo-Proveedor-2')?.acciones).toEqual([]);
    const bache = lista.find((a) => a.id.startsWith('bache-'));
    expect(bache).toBeDefined();
    expect(bache?.acciones.some((a) => a.compromisoId === 'Proveedor-2')).toBe(false);
  });

  it('con pocos datos no anuncia baches ni excedentes', () => {
    const datos = { ...PANADERIA, saldo: 100, cantidadMovimientos: 0, compromisos: [] };
    expect(alertas(datos, proyectar(datos))).toEqual([]);
  });
});
