import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import readXlsxFile from 'read-excel-file/node';
import { convertirFilas, detectarEncabezado, parsearCsv, parsearFecha, parsearMonto, type Celda } from '../shared/importacion';

describe('fechas', () => {
  it.each([
    ['04/11/2026', '2026-11-04'],
    ['4/9/26', '2026-09-04'],
    ['04-11-2026', '2026-11-04'],
    ['2026-11-04', '2026-11-04'],
    ['2026-11-04 10:30', '2026-11-04'],
    [46330, '2026-11-04'],
    [new Date(Date.UTC(2026, 10, 4)), '2026-11-04'],
  ])('%s es %s', (entrada, esperado) => {
    expect(parsearFecha(entrada as Celda)).toBe(esperado);
  });

  it.each(['31/02/2026', 'mañana', '', null, 12, 'Total'])('rechaza %s', (entrada) => {
    expect(parsearFecha(entrada as Celda)).toBeNull();
  });
});

describe('montos', () => {
  it.each([
    ['$ 186.400,50', 186400.5],
    ['1.234.567', 1234567],
    ['1,234,567', 1234567],
    ['1,234.56', 1234.56],
    ['1234,5', 1234.5],
    ['80000', 80000],
    ['-80.000', -80000],
    ['(1.000)', -1000],
    ['$ -500', -500],
    [1500.75, 1500.75],
  ])('%s es %s', (entrada, esperado) => {
    expect(parsearMonto(entrada as Celda)).toBe(esperado);
  });

  it.each(['', null, 'gratis', '-'])('rechaza %s', (entrada) => {
    expect(parsearMonto(entrada as Celda)).toBeNull();
  });
});

describe('csv', () => {
  it('entiende punto y coma, comillas y saltos de línea', () => {
    expect(parsearCsv('Fecha;Concepto;Monto\r\n01/09/2026;"Harina; 25 kg";"80.000,50"\n')).toEqual([
      ['Fecha', 'Concepto', 'Monto'],
      ['01/09/2026', 'Harina; 25 kg', '80.000,50'],
    ]);
  });

  it('detecta la coma como separador y quita la marca de Excel', () => {
    expect(parsearCsv('﻿Fecha,Monto\n"01/09/2026","1,50"')).toEqual([
      ['Fecha', 'Monto'],
      ['01/09/2026', '1,50'],
    ]);
  });
});

describe('planilla real de Excel', () => {
  it('encuentra el encabezado debajo del título y separa lo válido de lo inválido', async () => {
    const [hoja] = await readXlsxFile(resolve(import.meta.dirname, 'fixtures/caja.xlsx'));
    const filas = hoja.data as Celda[][];
    const { indice, mapeo } = detectarEncabezado(filas);
    expect(indice).toBe(2);
    expect(mapeo).toMatchObject({ fecha: 0, concepto: 1, ingreso: 2, egreso: 3, categoria: 4, monto: null });

    const r = convertirFilas(filas, indice + 1, mapeo);
    expect(r.ambiguo).toBe(false);
    expect(r.validas).toEqual([
      { tipo: 'ingreso', monto: 1850000, concepto: 'Ventas de la semana', categoria: 'Ventas', fecha: '2026-09-01' },
      { tipo: 'egreso', monto: 186401, concepto: 'Molinos Sur', categoria: 'Insumos', fecha: '2026-09-02' },
      { tipo: 'egreso', monto: 38000, concepto: 'Gas envasado', categoria: 'Servicios', fecha: '2026-09-03' },
      { tipo: 'egreso', monto: 38000, concepto: 'Gas envasado', categoria: 'Servicios', fecha: '2026-09-03' },
    ]);
    expect(r.errores.map((e) => e.fila)).toEqual([8, 9, 10]);
  });

  it('una planilla sin fechas válidas no inventa movimientos', () => {
    const { mapeo } = detectarEncabezado([['Fecha', 'Monto']]);
    expect(convertirFilas([['Fecha', 'Monto'], ['x', 100]], 1, mapeo).validas).toEqual([]);
  });
});

describe('tipo de movimiento', () => {
  const con = (encabezado: Celda[], fila: Celda[], opciones = {}) => {
    const { mapeo } = detectarEncabezado([encabezado]);
    return convertirFilas([encabezado, fila], 1, mapeo, opciones);
  };

  it('el signo negativo es un egreso', () => {
    expect(con(['Fecha', 'Importe'], ['01/09/2026', '-500']).validas[0]).toMatchObject({ tipo: 'egreso', monto: 500 });
  });

  it('la columna tipo manda sobre el signo', () => {
    expect(con(['Fecha', 'Monto', 'Tipo'], ['01/09/2026', 500, 'Gasto']).validas[0].tipo).toBe('egreso');
    expect(con(['Fecha', 'Monto', 'Tipo'], ['01/09/2026', 500, 'Venta']).validas[0].tipo).toBe('ingreso');
  });

  it('si todo es positivo y no hay tipo, avisa y deja elegir', () => {
    const r = con(['Fecha', 'Monto'], ['01/09/2026', 500]);
    expect(r.ambiguo).toBe(true);
    expect(r.validas[0].tipo).toBe('ingreso');
    expect(con(['Fecha', 'Monto'], ['01/09/2026', 500], { positivosSon: 'egreso' }).validas[0].tipo).toBe('egreso');
  });

  it('rechaza una fila con ingreso y egreso a la vez, y montos fuera de rango', () => {
    expect(con(['Fecha', 'Ingreso', 'Egreso'], ['01/09/2026', 10, 20]).errores).toHaveLength(1);
    expect(con(['Fecha', 'Monto'], ['01/09/2026', 1e15]).errores).toHaveLength(1);
  });

  it('completa concepto y categoría que faltan', () => {
    expect(con(['Fecha', 'Monto'], ['01/09/2026', -5]).validas[0]).toMatchObject({ concepto: 'Sin concepto', categoria: 'Otros gastos' });
  });
});
