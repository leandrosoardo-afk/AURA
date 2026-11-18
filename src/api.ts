import type { Adaptacion } from '../shared/adaptacion';
import type { Respuestas, TipoUsuario } from '../shared/cuestionario';

export interface Plan {
  codigo: string;
  nombre: string;
  precio_mensual_ars: number;
  incluye_publicidad: boolean;
  limite_registros_mes: number | null;
  modulos: string[];
  beneficios: string[];
}

export interface Yo {
  usuario: { id: string; email: string; tipo: TipoUsuario };
  perfil: { nombre: string; apellido: string | null; nombreNegocio: string | null; respuestas: Respuestas; fotoVersion: string | null };
  plan: Plan & { estado: string };
  espacios: { id: string; nombre: string }[];
  adaptacion: Adaptacion;
}

export interface Movimiento {
  id: string;
  tipo: 'ingreso' | 'egreso';
  monto: number;
  concepto: string;
  categoria: string;
  fecha: string;
}

export interface Resumen {
  hoy: string;
  saldo: number;
  ingresosMes: number;
  egresosMes: number;
  /** Ingresos y egresos de cada día del mes en curso, hasta hoy. */
  diasMes: { fecha: string; ingresos: number; egresos: number }[];
  registrosMes: number;
  limiteRegistrosMes: number | null;
}

export class ErrorApi extends Error {
  constructor(
    mensaje: string,
    readonly status: number,
    readonly campo?: string,
    readonly codigo?: string,
  ) {
    super(mensaje);
  }
}

export async function api<T>(ruta: string, opciones: { metodo?: string; cuerpo?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${ruta}`, {
      method: opciones.metodo ?? 'GET',
      headers: opciones.cuerpo !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined,
    });
  } catch {
    throw new ErrorApi('No pudimos conectarnos. Revisá tu conexión y probá de nuevo.', 0);
  }
  const texto = await res.text();
  let datos: { error?: string; campo?: string; codigo?: string } | null = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    // Un proxy o servidor caído puede responder algo que no es JSON.
  }
  if (!res.ok) throw new ErrorApi(datos?.error ?? 'Algo falló en el servidor. Probá de nuevo.', res.status, datos?.campo, datos?.codigo);
  return datos as T;
}

const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

export function formatoPesos(monto: number): string {
  return pesos.format(monto);
}

export function fechaDeHoy(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}
