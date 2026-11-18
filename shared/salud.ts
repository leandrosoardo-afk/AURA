// Historial y salud financiera. Todo se calcula a partir de los movimientos registrados, así
// lo que se carga o se importa queda en el historial sin ningún paso extra. Sin IA y reproducible.
// La salud es una orientación para el usuario: nunca se usa como calificación crediticia.

import { sumarDias, type Nivel } from './motor';

export interface DiaMovimientos {
  fecha: string;
  ingresos: number;
  egresos: number;
  cantidad: number;
}

interface DiaSerie extends DiaMovimientos {
  saldo: number;
}

export interface Componente {
  id: 'resultado' | 'cobertura' | 'estabilidad' | 'proyeccion';
  nombre: string;
  puntaje: number;
  detalle: string;
}

export interface Salud {
  puntaje: number | null;
  nivel: Nivel;
  titulo: string;
  detalle: string;
  componentes: Componente[];
}

export interface MesHistorial {
  mes: string; // AAAA-MM
  ingresos: number;
  egresos: number;
  resultado: number;
  saldoCierre: number;
  saldoMinimo: number;
  diasBajoPiso: number;
  puntaje: number | null;
  nivel: Nivel;
}

export const DIAS_MINIMOS = 30;
export const MOVIMIENTOS_MINIMOS = 5;
const VENTANA = 90;
const PESOS: Record<Componente['id'], number> = { resultado: 0.35, cobertura: 0.3, estabilidad: 0.2, proyeccion: 0.15 };

const acotar = (v: number) => Math.max(0, Math.min(100, v));
const escalar = (v: number, cero: number, cien: number) => acotar(((v - cero) / (cien - cero)) * 100);

/** Un registro por día, sin huecos, desde el primer movimiento hasta `hasta`. */
function armarSerie(dias: DiaMovimientos[], hasta: string): DiaSerie[] {
  const propios = dias.filter((d) => d.fecha <= hasta).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (propios.length === 0) return [];
  const porFecha = new Map(propios.map((d) => [d.fecha, d]));
  const serie: DiaSerie[] = [];
  let saldo = 0;
  for (let fecha = propios[0].fecha; fecha <= hasta; fecha = sumarDias(fecha, 1)) {
    const d = porFecha.get(fecha);
    saldo += (d?.ingresos ?? 0) - (d?.egresos ?? 0);
    serie.push({ fecha, ingresos: d?.ingresos ?? 0, egresos: d?.egresos ?? 0, cantidad: d?.cantidad ?? 0, saldo });
  }
  return serie;
}

function sinDatos(serie: DiaSerie[], cantidad: number): Salud {
  const faltan: string[] = [];
  if (cantidad < MOVIMIENTOS_MINIMOS) faltan.push(`${MOVIMIENTOS_MINIMOS - cantidad} ${MOVIMIENTOS_MINIMOS - cantidad === 1 ? 'movimiento' : 'movimientos'}`);
  if (serie.length < DIAS_MINIMOS) faltan.push(`${DIAS_MINIMOS - serie.length} ${DIAS_MINIMOS - serie.length === 1 ? 'día' : 'días'} de historia`);
  return {
    puntaje: null,
    nivel: 'gris',
    titulo: 'Todavía faltan datos',
    detalle: `Para medirla necesitamos ${faltan.join(' y ')}. Importar tu planilla lo resuelve de una vez.`,
    componentes: [],
  };
}

function evaluarTramo(serie: DiaSerie[], fin: number, reserva: number, minimoProyectado: number | null): Salud {
  const hasta = serie.slice(0, fin + 1);
  const cantidad = hasta.reduce((s, d) => s + d.cantidad, 0);
  if (hasta.length < DIAS_MINIMOS || cantidad < MOVIMIENTOS_MINIMOS) return sinDatos(hasta, cantidad);

  const ventana = hasta.slice(-VENTANA);
  const ingresos = ventana.reduce((s, d) => s + d.ingresos, 0);
  const egresos = ventana.reduce((s, d) => s + d.egresos, 0);
  const saldo = hasta[hasta.length - 1].saldo;
  const gastoDiario = egresos / ventana.length;
  const margen = ingresos > 0 ? (ingresos - egresos) / ingresos : -1;
  const diasCobertura = gastoDiario > 0 ? saldo / gastoDiario : saldo > 0 ? Infinity : 0;
  const diasBien = ventana.filter((d) => d.saldo >= reserva).length / ventana.length;

  const componentes: Componente[] = [
    {
      id: 'resultado',
      nombre: 'Lo que te queda',
      puntaje: Math.round(escalar(margen, -0.1, 0.2)),
      detalle: ingresos > 0 ? `De cada $100 que entraron, ${margen >= 0 ? `te quedaron $${Math.round(margen * 100)}` : `gastaste $${Math.round(-margen * 100)} de más`}.` : 'No entró plata en los últimos meses.',
    },
    {
      id: 'cobertura',
      nombre: 'Días cubiertos',
      puntaje: Math.round(escalar(Math.min(diasCobertura, 60), 0, 30)),
      detalle: diasCobertura === Infinity ? 'No registraste gastos en los últimos meses.' : diasCobertura <= 0 ? 'Hoy no tenés saldo para cubrir gastos.' : `Tu saldo cubre ${Math.round(diasCobertura)} ${Math.round(diasCobertura) === 1 ? 'día' : 'días'} de gastos.`,
    },
    {
      id: 'estabilidad',
      nombre: 'Estabilidad',
      puntaje: Math.round(escalar(diasBien, 0.7, 1)),
      detalle: `${Math.round(diasBien * 100)}% de los días estuviste ${reserva > 0 ? 'arriba de tu reserva' : 'con saldo positivo'}.`,
    },
  ];
  if (minimoProyectado !== null) {
    componentes.push({
      id: 'proyeccion',
      nombre: 'Próximos 30 días',
      puntaje: Math.round(minimoProyectado < 0 ? 0 : reserva > 0 ? Math.min(100, (minimoProyectado / reserva) * 100) : 100),
      detalle: minimoProyectado < 0 ? 'La proyección muestra días sin plata.' : minimoProyectado < reserva ? 'La proyección baja de tu reserva.' : 'La proyección se mantiene arriba de tu reserva.',
    });
  }

  const pesoTotal = componentes.reduce((s, c) => s + PESOS[c.id], 0);
  const puntaje = Math.round(componentes.reduce((s, c) => s + c.puntaje * PESOS[c.id], 0) / pesoTotal);
  const nivel: Nivel = puntaje >= 70 ? 'verde' : puntaje >= 40 ? 'amarillo' : 'rojo';
  const debil = [...componentes].sort((a, b) => a.puntaje - b.puntaje)[0];
  return {
    puntaje,
    nivel,
    titulo: nivel === 'verde' ? 'Tu salud financiera es buena' : nivel === 'amarillo' ? 'Tu salud financiera necesita atención' : 'Tu salud financiera está en riesgo',
    detalle: debil.puntaje >= 70 ? debil.detalle : `Para mejorarla, mirá primero esto: ${debil.detalle.charAt(0).toLowerCase()}${debil.detalle.slice(1)}`,
    componentes,
  };
}

export function calcularSalud(dias: DiaMovimientos[], hoy: string, reserva: number, minimoProyectado: number | null = null): Salud {
  const serie = armarSerie(dias, hoy);
  if (serie.length === 0) return sinDatos([], 0);
  return evaluarTramo(serie, serie.length - 1, reserva, minimoProyectado);
}

/** Resumen de cada mes, del más nuevo al más viejo, con la salud que tenía al cerrar. */
export function calcularHistorial(dias: DiaMovimientos[], hoy: string, reserva: number, maximoMeses = 24): MesHistorial[] {
  const serie = armarSerie(dias, hoy);
  const meses = new Map<string, MesHistorial>();
  serie.forEach((d, indice) => {
    const clave = d.fecha.slice(0, 7);
    const mes = meses.get(clave) ?? { mes: clave, ingresos: 0, egresos: 0, resultado: 0, saldoCierre: 0, saldoMinimo: Infinity, diasBajoPiso: 0, puntaje: null, nivel: 'gris' as Nivel };
    mes.ingresos += d.ingresos;
    mes.egresos += d.egresos;
    mes.resultado = mes.ingresos - mes.egresos;
    mes.saldoCierre = d.saldo;
    mes.saldoMinimo = Math.min(mes.saldoMinimo, d.saldo);
    if (d.saldo < reserva) mes.diasBajoPiso++;
    meses.set(clave, mes);
    const esCierre = indice === serie.length - 1 || serie[indice + 1].fecha.slice(0, 7) !== clave;
    if (esCierre) {
      const salud = evaluarTramo(serie, indice, reserva, null);
      mes.puntaje = salud.puntaje;
      mes.nivel = salud.nivel;
    }
  });
  return [...meses.values()].reverse().slice(0, maximoMeses);
}

/**
 * Lo que entra y lo que sale por día, en promedio, con los movimientos de los últimos 90 días
 * (o desde el primero, si hay menos). Devuelve null sin movimientos: nunca completa con valores supuestos.
 */
export function promediosDiarios(dias: DiaMovimientos[], hoy: string) {
  const serie = armarSerie(dias, hoy);
  if (serie.length === 0) return null;
  const ventana = serie.slice(-VENTANA);
  const ventaDiaria = ventana.reduce((s, d) => s + d.ingresos, 0) / ventana.length;
  const gastoDiario = ventana.reduce((s, d) => s + d.egresos, 0) / ventana.length;
  return {
    ventaDiaria,
    gastoDiario,
    // Lo que queda por mes: con esto se mide si una cuota es segura.
    margen: Math.max(0, (ventaDiaria - gastoDiario) * 30),
    diasHistoria: ventana.length,
  };
}
