// Motor financiero: funciones puras, sin IA y sin efectos. Toda cifra de la app sale de acá.
// La fecha de hoy siempre entra como dato, así el resultado es reproducible.

export type Nivel = 'verde' | 'amarillo' | 'rojo' | 'gris';
export type Escenario = 'base' | 'conservador' | 'estres';

export interface CompromisoCaja {
  id: string;
  fecha: string; // AAAA-MM-DD
  monto: number; // pago < 0, cobro > 0
  concepto: string;
  categoria: string;
  avisoDias: number;
  /** Movimiento cargado con fecha futura: se descuenta solo ese día, no hay que marcarlo pagado. */
  automatico?: boolean;
}

export interface DatosCaja {
  hoy: string;
  saldo: number;
  reserva: number;
  margen: number;
  ventaDiaria: number;
  gastoDiario: number;
  compromisos: CompromisoCaja[];
  cantidadMovimientos: number;
}

export interface Simulacion {
  cuota: number;
  n: number;
  dia: number;
  anticipo?: number;
  diaAnticipo?: number;
}

export interface Minimo {
  v: number;
  d: number;
}

export interface Evaluacion {
  nivel: Nivel;
  razones: string[];
  minimo: Minimo;
}

export const MINIMO_MOVIMIENTOS = 5;
export const LIMITE_SEGURO = 0.3;
export const LIMITE_PRECAUCION = 0.4;

export const ESCENARIOS: Record<Escenario, { nombre: string; ventas: number; demora: number; detalle: string }> = {
  base: { nombre: 'Base', ventas: 1, demora: 0, detalle: 'Ventas y cobros según lo que cargaste.' },
  conservador: { nombre: 'Conservador', ventas: 0.85, demora: 5, detalle: 'Ventas 15% más bajas y cobros 5 días más tarde.' },
  estres: { nombre: 'Estrés', ventas: 0.7, demora: 10, detalle: 'Ventas 30% más bajas y cobros 10 días más tarde.' },
};

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 864e5);
}

export function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 864e5).toISOString().slice(0, 10);
}

export function fechaCorta(fecha: string): string {
  const f = new Date(`${fecha}T00:00:00Z`);
  const dia = f.toLocaleDateString('es-AR', { weekday: 'short', timeZone: 'UTC' }).replace(/[.,]/g, '');
  return `${dia} ${f.getUTCDate()}/${f.getUTCMonth() + 1}`;
}

const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

export function fmt(monto: number): string {
  return pesos.format(Math.round(monto));
}

export function fmtCompacto(monto: number): string {
  const absoluto = Math.abs(monto);
  const signo = monto < 0 ? '−' : '';
  if (absoluto >= 1e6) return `${signo}$${(absoluto / 1e6).toFixed(1).replace('.', ',').replace(',0', '')} M`;
  if (absoluto >= 1000) return `${signo}$${Math.round(absoluto / 1000)} mil`;
  return `${signo}$${Math.round(absoluto)}`;
}

export function cuotaFrancesa(capital: number, cuotas: number, tna: number): number {
  const i = tna / 1200;
  return i === 0 ? capital / cuotas : (capital * i) / (1 - Math.pow(1 + i, -cuotas));
}

export function minimo(proyeccion: number[]): Minimo {
  return proyeccion.reduce((m, v, d) => (v < m.v ? { v, d } : m), { v: Infinity, d: 0 });
}

/** Saldo estimado de cada día, de hoy (posición 0) a 30 días. */
export function proyectar(datos: DatosCaja, escenario: Escenario = 'base', sim: Simulacion | null = null): number[] {
  const factor = ESCENARIOS[escenario];
  const salida = [datos.saldo];
  let saldo = datos.saldo;

  for (let d = 1; d <= 30; d++) {
    saldo += datos.ventaDiaria * factor.ventas - datos.gastoDiario;
    for (const c of datos.compromisos) {
      const dias = diasEntre(datos.hoy, c.fecha);
      // Un pago vencido sigue pendiente y sale mañana. Un cobro atrasado no se cuenta: nadie
      // garantiza que entre, y es mejor que la proyección quede corta que tranquilizadora.
      if (c.monto > 0 && dias < 0) continue;
      const diaEfectivo = Math.max(1, c.monto > 0 ? dias + factor.demora : dias);
      if (diaEfectivo === d) saldo += c.monto;
    }
    if (sim && d >= sim.dia && (d - sim.dia) % 30 === 0 && (d - sim.dia) / 30 < sim.n) saldo -= sim.cuota;
    if (sim?.anticipo && Math.max(1, sim.diaAnticipo ?? 1) === d) saldo -= sim.anticipo;
    salida.push(saldo);
  }
  return salida;
}

export function datosInsuficientes(datos: DatosCaja): boolean {
  return datos.cantidadMovimientos < MINIMO_MOVIMIENTOS;
}

export function evaluar(datos: DatosCaja, proyeccion: number[], cuota?: number): Evaluacion {
  const m = minimo(proyeccion);
  if (datosInsuficientes(datos)) {
    const faltan = MINIMO_MOVIMIENTOS - datos.cantidadMovimientos;
    return { nivel: 'gris', razones: [`Registrá ${faltan} ${faltan === 1 ? 'movimiento más' : 'movimientos más'} para evaluar tu caja con confianza.`], minimo: m };
  }

  const razones: string[] = [];
  const dia = fechaCorta(sumarDias(datos.hoy, m.d));
  const sinMargen = Boolean(cuota) && datos.margen <= 0;
  const proporcion = cuota && datos.margen > 0 ? cuota / datos.margen : 0;

  let nivel: Nivel = 'verde';
  if (m.v < 0 || sinMargen || proporcion > LIMITE_PRECAUCION) nivel = 'rojo';
  else if (m.v < datos.reserva || proporcion > LIMITE_SEGURO) nivel = 'amarillo';

  if (m.v < 0) razones.push(`El ${dia} la caja quedaría en ${fmt(m.v)}: faltaría plata.`);
  else if (m.v < datos.reserva) razones.push(`El ${dia} quedarías ${fmt(datos.reserva - m.v)} debajo de tu reserva de ${fmt(datos.reserva)}.`);
  else razones.push(`Tu peor día es el ${dia}, con ${fmt(m.v)}: queda arriba de la reserva.`);

  if (sinMargen) {
    razones.push('Hoy no te queda margen por mes: cualquier cuota saldría de tu reserva.');
  } else if (cuota) {
    const porcentaje = `${Math.round(proporcion * 100)}%`;
    if (proporcion > LIMITE_PRECAUCION) razones.push(`La cuota es el ${porcentaje} de lo que te queda por mes (máximo recomendado: 30%).`);
    else if (proporcion > LIMITE_SEGURO) razones.push(`La cuota es el ${porcentaje} de lo que te queda por mes: zona de precaución.`);
    else razones.push(`La cuota es el ${porcentaje} de lo que te queda por mes: dentro del límite seguro.`);
  }
  return { nivel, razones, minimo: m };
}

/** La frase que contesta "¿me alcanza?" antes de mostrar los números. */
export function fraseRespuesta(datos: DatosCaja, evaluacion: Evaluacion): string {
  const { nivel, minimo: m } = evaluacion;
  const dia = fechaCorta(sumarDias(datos.hoy, m.d));
  if (nivel === 'gris') return 'Todavía no alcanza la información para responderte.';
  if (m.v < 0) return `No te alcanza: el ${dia} te faltarían ${fmt(-m.v)}.`;
  if (m.v < datos.reserva) return `Te alcanza, pero el ${dia} quedás ${fmt(datos.reserva - m.v)} debajo de tu reserva.`;
  return `Te alcanza. Tu peor día queda ${fmt(m.v - datos.reserva)} arriba de tu reserva.`;
}

export interface AccionAlerta {
  tipo: 'pagar' | 'reprogramar' | 'simular';
  texto: string;
  compromisoId?: string;
  dias?: number;
}

export interface Alerta {
  id: string;
  nivel: 'rojo' | 'amarillo' | 'info' | 'verde' | 'gris';
  titulo: string;
  detalle: string;
  acciones: AccionAlerta[];
}

export function alertas(datos: DatosCaja, proyeccion: number[]): Alerta[] {
  const m = minimo(proyeccion);
  const salida: Alerta[] = [];
  const dias = (c: CompromisoCaja) => diasEntre(datos.hoy, c.fecha);
  const insuficiente = datosInsuficientes(datos);

  for (const c of datos.compromisos.filter((x) => dias(x) < 0)) {
    salida.push(
      c.monto < 0
        ? {
            id: `vencido-${c.id}`,
            nivel: 'rojo',
            titulo: `Vencido: ${c.concepto}`,
            detalle: `Vencía el ${fechaCorta(c.fecha)} (${fmt(-c.monto)}). Pagarlo tarde puede generar recargos.`,
            acciones: [{ tipo: 'pagar', texto: 'Marcar pagado', compromisoId: c.id }],
          }
        : {
            id: `atrasado-${c.id}`,
            nivel: 'amarillo',
            titulo: `Cobro atrasado: ${c.concepto}`,
            detalle: `Lo esperabas el ${fechaCorta(c.fecha)} (${fmt(c.monto)}). No lo contamos en tu caja hasta que entre.`,
            acciones: [{ tipo: 'pagar', texto: 'Marcar cobrado', compromisoId: c.id }],
          },
    );
  }

  if (!insuficiente && m.v < datos.reserva) {
    const cerca = datos.compromisos.filter((c) => c.monto < 0 && Math.abs(dias(c) - m.d) <= 3);
    const aMover = datos.compromisos
      .filter((c) => c.monto < 0 && !c.automatico && c.categoria !== 'Sueldos' && dias(c) >= 0 && dias(c) <= m.d)
      .sort((a, b) => a.monto - b.monto)[0];
    const dia = fechaCorta(sumarDias(datos.hoy, m.d));
    salida.push({
      id: `bache-${sumarDias(datos.hoy, m.d)}`,
      nivel: m.v < 0 ? 'rojo' : 'amarillo',
      titulo: m.v < 0 ? `Faltante de ${fmt(-m.v)} el ${dia}` : `Te quedás corto el ${dia}`,
      detalle: `Tu caja baja a ${fmt(m.v)} y tu reserva es de ${fmt(datos.reserva)}. Lo explican: ${
        cerca.map((c) => `${c.concepto} (${fmt(-c.monto)})`).join(', ') || 'los gastos acumulados'
      }.`,
      acciones: [
        ...(aMover ? [{ tipo: 'reprogramar' as const, texto: `Pasar “${aMover.concepto}” 7 días`, compromisoId: aMover.id, dias: 7 }] : []),
        { tipo: 'simular', texto: 'Simular alternativas' },
      ],
    });
  }

  for (const c of datos.compromisos.filter((x) => x.monto < 0 && dias(x) >= 0 && dias(x) <= x.avisoDias)) {
    salida.push({
      id: `proximo-${c.id}`,
      nivel: 'info',
      titulo: `Vence ${dias(c) === 0 ? 'hoy' : `el ${fechaCorta(c.fecha)}`}: ${c.concepto}`,
      detalle: c.automatico ? `${fmt(-c.monto)}. Se descuenta solo ese día.` : `${fmt(-c.monto)}.`,
      acciones: c.automatico ? [] : [{ tipo: 'pagar', texto: 'Marcar pagado', compromisoId: c.id }],
    });
  }

  if (!insuficiente && datos.reserva > 0 && m.v - datos.reserva > datos.reserva * 2) {
    salida.push({
      id: `excedente-${datos.hoy}`,
      nivel: 'verde',
      titulo: 'Te sobra margen este mes',
      detalle: `En los próximos 30 días tu caja no baja de ${fmt(m.v)}. Antes de usar lo que sobra, mirá también el escenario de estrés. Esto no es una recomendación de inversión.`,
      acciones: [],
    });
  }
  return salida;
}

export interface EntradaSimulador {
  precio: number;
  anticipo: number;
  diaAnticipo: number;
  cuotas: number;
  tna: number;
  diaCuota: number;
}

export interface FilaAmortizacion {
  n: number;
  interes: number;
  capital: number;
  saldo: number;
}

export interface ResultadoSimulador extends Evaluacion {
  cuota: number;
  total: number;
  intereses: number;
  proporcion: number | null;
  sinOperacion: number[];
  conOperacion: number[];
  comparacion: { cuotas: number; cuota: number; proporcion: number | null; nivel: Nivel }[];
  amortizacion: FilaAmortizacion[];
  alternativa: string | null;
}

export const OPCIONES_CUOTAS = [3, 6, 12, 18, 24];

export function amortizar(capital: number, cuotas: number, tna: number): FilaAmortizacion[] {
  const cuota = cuotaFrancesa(capital, cuotas, tna);
  const filas: FilaAmortizacion[] = [];
  let saldo = capital;
  for (let n = 1; n <= cuotas; n++) {
    const interes = (saldo * tna) / 1200;
    const amortizado = cuota - interes;
    saldo = n === cuotas ? 0 : saldo - amortizado;
    filas.push({ n, interes, capital: amortizado, saldo });
  }
  return filas;
}

export function simular(datos: DatosCaja, e: EntradaSimulador): ResultadoSimulador {
  const financiado = e.precio - e.anticipo;
  const operacion = (cuotas: number): Simulacion => ({
    cuota: cuotaFrancesa(financiado, cuotas, e.tna),
    n: cuotas,
    dia: e.diaCuota,
    anticipo: e.anticipo,
    diaAnticipo: e.diaAnticipo,
  });
  const proporcionDe = (cuota: number) => (datos.margen > 0 ? cuota / datos.margen : null);

  const sim = operacion(e.cuotas);
  const conOperacion = proyectar(datos, 'base', sim);
  const evaluacion = evaluar(datos, conOperacion, sim.cuota);

  let alternativa: string | null = null;
  if ((evaluacion.nivel === 'rojo' || evaluacion.nivel === 'amarillo') && datos.margen > 0) {
    const cuotaSegura = datos.margen * LIMITE_SEGURO;
    const i = e.tna / 1200;
    const maximo = i === 0 ? cuotaSegura * e.cuotas : (cuotaSegura * (1 - Math.pow(1 + i, -e.cuotas))) / i;
    if (maximo < financiado) {
      alternativa = `En ${e.cuotas} cuotas, financiá hasta ${fmt(maximo)} con un anticipo de ${fmt(e.precio - maximo)}, o probá con más cuotas.`;
    }
  }

  return {
    ...evaluacion,
    cuota: sim.cuota,
    total: e.anticipo + sim.cuota * e.cuotas,
    intereses: sim.cuota * e.cuotas - financiado,
    proporcion: proporcionDe(sim.cuota),
    sinOperacion: proyectar(datos, 'base'),
    conOperacion,
    comparacion: OPCIONES_CUOTAS.map((cuotas) => {
      const alternativaSim = operacion(cuotas);
      return {
        cuotas,
        cuota: alternativaSim.cuota,
        proporcion: proporcionDe(alternativaSim.cuota),
        nivel: evaluar(datos, proyectar(datos, 'base', alternativaSim), alternativaSim.cuota).nivel,
      };
    }),
    amortizacion: amortizar(financiado, e.cuotas, e.tna),
    alternativa,
  };
}
