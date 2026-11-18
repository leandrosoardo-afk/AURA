import { describe, expect, it } from 'vitest';
import { sumarDias } from '../shared/motor';
import { calcularHistorial, calcularSalud, promediosDiarios, type DiaMovimientos } from '../shared/salud';

const HOY = '2026-11-04';

function serie(dias: number, ingreso: number, egreso: number, inicial = 0): DiaMovimientos[] {
  return Array.from({ length: dias }, (_, i) => ({
    fecha: sumarDias(HOY, i - dias + 1),
    ingresos: ingreso + (i === 0 ? inicial : 0),
    egresos: egreso,
    cantidad: 2,
  }));
}

describe('salud financiera', () => {
  it('sin movimientos da gris y no inventa un puntaje', () => {
    const s = calcularSalud([], HOY, 0);
    expect(s.puntaje).toBeNull();
    expect(s.nivel).toBe('gris');
  });

  it('con menos de 30 días da gris y dice cuánto falta', () => {
    const s = calcularSalud(serie(10, 100, 50), HOY, 0);
    expect(s.puntaje).toBeNull();
    expect(s.detalle).toContain('20 días');
  });

  it('con pocos movimientos da gris aunque haya muchos días', () => {
    const s = calcularSalud([{ fecha: sumarDias(HOY, -60), ingresos: 100, egresos: 0, cantidad: 1 }], HOY, 0);
    expect(s.puntaje).toBeNull();
    expect(s.detalle).toContain('4 movimientos');
  });

  it('buen margen, saldo holgado y estable da verde', () => {
    const s = calcularSalud(serie(90, 1000, 700, 50000), HOY, 1000);
    expect(s.nivel).toBe('verde');
    expect(s.puntaje).toBeGreaterThanOrEqual(70);
    expect(s.componentes.map((c) => c.id)).toEqual(['resultado', 'cobertura', 'estabilidad']);
  });

  it('gastar más de lo que entra y quedarse sin saldo da rojo', () => {
    const s = calcularSalud(serie(90, 500, 1000), HOY, 0);
    expect(s.nivel).toBe('rojo');
    expect(s.puntaje).toBeLessThan(40);
  });

  it('margen justo y saldo chico da amarillo', () => {
    // 120 días: el saldo inicial queda fuera de la ventana de 90 y no cuenta como ingreso.
    const s = calcularSalud(serie(120, 1000, 950, 12000), HOY, 0);
    expect(s.nivel).toBe('amarillo');
  });

  it('una proyección mala baja el puntaje', () => {
    const dias = serie(90, 1000, 700, 50000);
    const sin = calcularSalud(dias, HOY, 1000).puntaje!;
    const con = calcularSalud(dias, HOY, 1000, -5000).puntaje!;
    expect(con).toBeLessThan(sin);
    expect(calcularSalud(dias, HOY, 1000, -5000).componentes.at(-1)?.id).toBe('proyeccion');
  });

  it('el puntaje queda entre 0 y 100, incluso con datos extremos', () => {
    for (const dias of [serie(90, 0, 1e9), serie(90, 1e9, 0), serie(90, 0, 0, 1e9)]) {
      const p = calcularSalud(dias, HOY, 0).puntaje!;
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });

  it('ignora movimientos con fecha futura', () => {
    const dias = [...serie(90, 1000, 700, 50000), { fecha: sumarDias(HOY, 5), ingresos: 0, egresos: 1e9, cantidad: 1 }];
    expect(calcularSalud(dias, HOY, 1000).nivel).toBe('verde');
  });

  it('da el mismo resultado sin importar el orden de los datos', () => {
    const dias = serie(90, 1000, 700, 50000);
    expect(calcularSalud([...dias].reverse(), HOY, 1000)).toEqual(calcularSalud(dias, HOY, 1000));
  });
});

describe('historial automático', () => {
  it('resume cada mes con saldo acumulado, del más nuevo al más viejo', () => {
    const dias: DiaMovimientos[] = [
      { fecha: '2026-09-10', ingresos: 1000, egresos: 0, cantidad: 1 },
      { fecha: '2026-09-20', ingresos: 0, egresos: 1500, cantidad: 1 },
      { fecha: '2026-10-05', ingresos: 2000, egresos: 100, cantidad: 1 },
    ];
    const h = calcularHistorial(dias, '2026-10-31', 0);
    expect(h.map((m) => m.mes)).toEqual(['2026-10', '2026-09']);
    expect(h[1]).toMatchObject({ ingresos: 1000, egresos: 1500, resultado: -500, saldoCierre: -500, saldoMinimo: -500, diasBajoPiso: 11 });
    expect(h[0]).toMatchObject({ resultado: 1900, saldoCierre: 1400 });
  });

  it('la salud de cada mes se calcula con lo que se sabía al cierre', () => {
    const h = calcularHistorial(serie(120, 1000, 700, 50000), HOY, 0);
    expect(h.at(-1)?.puntaje).toBeNull();
    expect(h[0].puntaje).not.toBeNull();
  });

  it('sin movimientos no hay historial', () => {
    expect(calcularHistorial([], HOY, 0)).toEqual([]);
  });

  it('muestra como máximo 24 meses', () => {
    expect(calcularHistorial(serie(1200, 10, 5), HOY, 0).length).toBe(24);
  });
});

describe('lo que entra y lo que sale, calculado con los movimientos', () => {
  it('sin movimientos no calcula nada', () => {
    expect(promediosDiarios([], HOY)).toBeNull();
  });

  it('con pocos días promedia sobre los días que hay', () => {
    expect(promediosDiarios(serie(10, 100, 50), HOY)).toEqual({ ventaDiaria: 100, gastoDiario: 50, margen: 1500, diasHistoria: 10 });
  });

  it('con más de 90 días usa solo los últimos 90', () => {
    const viejos = serie(30, 99999, 99999).map((d) => ({ ...d, fecha: sumarDias(d.fecha, -90) }));
    const p = promediosDiarios([...viejos, ...serie(90, 1000, 700)], HOY)!;
    expect(p).toEqual({ ventaDiaria: 1000, gastoDiario: 700, margen: 9000, diasHistoria: 90 });
  });

  it('cuenta los días sin movimientos dentro del período', () => {
    const p = promediosDiarios([{ fecha: sumarDias(HOY, -9), ingresos: 1000, egresos: 0, cantidad: 1 }], HOY)!;
    expect(p.ventaDiaria).toBe(100);
    expect(p.diasHistoria).toBe(10);
  });

  it('si gasta más de lo que entra, lo que queda por mes es cero', () => {
    expect(promediosDiarios(serie(40, 100, 700), HOY)?.margen).toBe(0);
  });

  it('ignora movimientos con fecha futura', () => {
    expect(promediosDiarios([...serie(10, 100, 50), { fecha: sumarDias(HOY, 3), ingresos: 0, egresos: 1e9, cantidad: 1 }], HOY)?.gastoDiario).toBe(50);
  });
});
