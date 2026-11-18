// Controles compartidos por las rutas de un espacio de trabajo.

import type { Request } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import type { DatosCaja } from '../shared/motor';
import { promediosDiarios, type DiaMovimientos } from '../shared/salud';

export const ZONA = 'America/Argentina/Buenos_Aires';

/** Corta el pedido con una respuesta concreta. Dentro de conUsuario() también revierte la transacción. */
export class ErrorHttp extends Error {
  constructor(
    readonly status: number,
    readonly cuerpo: Record<string, unknown>,
  ) {
    super(String(cuerpo.error));
  }
}

export function hoyArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
}

export function validar<T>(esquema: z.ZodType<T>, datos: unknown): T {
  const resultado = esquema.safeParse(datos);
  if (!resultado.success) throw new ErrorHttp(400, { error: resultado.error.issues[0].message });
  return resultado.data;
}

const uuid = z.uuid();

export function idValido(valor: unknown): string | null {
  const id = uuid.safeParse(valor);
  return id.success ? id.data : null;
}

/**
 * Busca el espacio entre los del usuario. Un espacio ajeno o inexistente da el mismo
 * resultado, para que la respuesta no revele si ese id existe.
 */
export async function espacioPropio(c: pg.PoolClient, req: Request): Promise<string> {
  const id = idValido(req.params.espacioId);
  if (id) {
    const { rows } = await c.query('SELECT id FROM espacios_trabajo WHERE id = $1 AND usuario_id = $2', [id, req.usuario.id]);
    if (rows[0]) return rows[0].id;
  }
  throw new ErrorHttp(404, { error: 'No encontramos ese espacio de trabajo.' });
}

/** El plan se lee siempre de la base: lo que muestre la interfaz no habilita nada. */
export async function exigirModulo(c: pg.PoolClient, req: Request, modulo: string): Promise<void> {
  const { rows } = await c.query(
    `SELECT p.modulos, (SELECT nombre FROM planes WHERE $2 = ANY (modulos) ORDER BY orden LIMIT 1) AS necesario
     FROM suscripciones s JOIN planes p ON p.codigo = s.plan_codigo WHERE s.usuario_id = $1`,
    [req.usuario.id, modulo],
  );
  if (!rows[0].modulos.includes(modulo)) {
    throw new ErrorHttp(403, {
      error: `Esta función está incluida desde el plan ${rows[0].necesario}.`,
      codigo: 'modulo_no_incluido',
      planNecesario: rows[0].necesario,
    });
  }
}

/**
 * Reúne lo que necesita el motor. Ingresos y gastos salen de los movimientos; la reserva es lo único
 * que carga el usuario. Devuelve null si todavía no hay movimientos con qué proyectar.
 */
export async function datosDeCaja(c: pg.PoolClient, espacioId: string, hoy: string): Promise<(DatosCaja & { diasHistoria: number }) | null> {
  const promedios = promediosDiarios(await diasDeMovimientos(c, espacioId, { sinAgendados: true }), hoy);
  if (!promedios) return null;
  const guardada = (await c.query('SELECT reserva FROM parametros_caja WHERE espacio_id = $1', [espacioId])).rows[0];
  const movimientos = (
    await c.query(
      `SELECT count(*)::int AS cantidad,
              coalesce(sum(CASE WHEN tipo = 'ingreso' THEN monto_ars ELSE -monto_ars END) FILTER (WHERE fecha <= $2), 0)::text AS saldo
       FROM movimientos WHERE espacio_id = $1`,
      [espacioId, hoy],
    )
  ).rows[0];
  const compromisos = await c.query(
    `SELECT id, tipo, monto_ars::text AS monto, concepto, categoria, to_char(fecha, 'YYYY-MM-DD') AS fecha, aviso_dias
     FROM compromisos WHERE espacio_id = $1 AND estado = 'pendiente' ORDER BY compromisos.fecha`,
    [espacioId],
  );
  // Un gasto o ingreso cargado con fecha futura cuenta como agendado hasta que llega su día;
  // ese día entra solo en el saldo (que suma los movimientos hasta hoy) y sale de lo pendiente.
  const programados = await c.query(
    `SELECT id, tipo, monto_ars::text AS monto, concepto, categoria, to_char(fecha, 'YYYY-MM-DD') AS fecha
     FROM movimientos WHERE espacio_id = $1 AND fecha > $2 ORDER BY movimientos.fecha`,
    [espacioId, hoy],
  );
  return {
    hoy,
    saldo: Number(movimientos.saldo),
    cantidadMovimientos: movimientos.cantidad,
    reserva: guardada ? Number(guardada.reserva) : 0,
    ...promedios,
    compromisos: compromisos.rows.map((f) => ({
      id: f.id,
      fecha: f.fecha,
      monto: f.tipo === 'pago' ? -Number(f.monto) : Number(f.monto),
      concepto: f.concepto,
      categoria: f.categoria,
      avisoDias: f.aviso_dias,
    })).concat(
      programados.rows.map((f) => ({
        id: f.id,
        fecha: f.fecha,
        monto: f.tipo === 'egreso' ? -Number(f.monto) : Number(f.monto),
        concepto: f.concepto,
        categoria: f.categoria,
        avisoDias: 2,
        automatico: true,
      })),
    ),
  };
}

/**
 * Los movimientos sumados por día. De acá salen el historial, la salud financiera y los promedios
 * de la caja. Para los promedios se dejan afuera los pagos de vencimientos, que ya están agendados.
 */
export async function diasDeMovimientos(c: pg.PoolClient, espacioId: string, { sinAgendados = false } = {}): Promise<DiaMovimientos[]> {
  const { rows } = await c.query(
    `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha,
            coalesce(sum(monto_ars) FILTER (WHERE tipo = 'ingreso'), 0)::text AS ingresos,
            coalesce(sum(monto_ars) FILTER (WHERE tipo = 'egreso'), 0)::text AS egresos,
            count(*)::int AS cantidad
     FROM movimientos WHERE espacio_id = $1 AND (NOT $2 OR compromiso_id IS NULL) GROUP BY movimientos.fecha`,
    [espacioId, sinAgendados],
  );
  return rows.map((f) => ({ fecha: f.fecha, ingresos: Number(f.ingresos), egresos: Number(f.egresos), cantidad: f.cantidad }));
}
