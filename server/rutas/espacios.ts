import { Router } from 'express';
import type pg from 'pg';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { MAXIMO_FILAS } from '../../shared/importacion';
import { ErrorHttp, espacioPropio, hoyArgentina, idValido, validar, ZONA } from '../acceso';
import { conUsuario } from '../db';
import { requerirSesion } from '../sesion';
import { rutasCaja } from './caja';
import { revertirPago, rutasCompromisos, volverAPagar } from './compromisos';
import { rutasInformes } from './informes';

const movimientoNuevo = z.object({
  tipo: z.enum(['ingreso', 'egreso']),
  monto: z.number().int('El monto va sin centavos.').positive('Escribí un monto mayor a cero.').max(1_000_000_000_000),
  concepto: z.string().trim().min(1, 'Escribí un concepto.').max(120),
  categoria: z.string().trim().min(1, 'Elegí una categoría.').max(60),
  fecha: z.iso.date('Revisá la fecha.'),
});

const MAXIMO_LISTA = 1000;

const filtroMovimientos = z
  .object({
    desde: z.iso.date('Revisá la fecha desde.').optional(),
    hasta: z.iso.date('Revisá la fecha hasta.').optional(),
    tipo: z.enum(['ingreso', 'egreso']).optional(),
  })
  .refine((f) => !f.desde || !f.hasta || f.desde <= f.hasta, { message: 'La fecha desde tiene que ser anterior a la fecha hasta.' });

const importacion = z.object({
  filas: z.array(movimientoNuevo).min(1, 'El archivo no tiene movimientos para importar.').max(MAXIMO_FILAS, `Se pueden importar hasta ${MAXIMO_FILAS} filas por vez.`),
});

async function resumen(c: pg.PoolClient, espacioId: string, usuarioId: string) {
  const totales = (
    await c.query(
      `WITH hoy AS (SELECT (now() AT TIME ZONE $2)::date AS d)
       SELECT
         coalesce(sum(CASE WHEN tipo = 'ingreso' THEN monto_ars ELSE -monto_ars END) FILTER (WHERE fecha <= hoy.d), 0)::text AS saldo,
         coalesce(sum(monto_ars) FILTER (WHERE tipo = 'ingreso' AND fecha <= hoy.d AND date_trunc('month', fecha) = date_trunc('month', hoy.d)), 0)::text AS ingresos_mes,
         coalesce(sum(monto_ars) FILTER (WHERE tipo = 'egreso' AND fecha <= hoy.d AND date_trunc('month', fecha) = date_trunc('month', hoy.d)), 0)::text AS egresos_mes
       FROM hoy LEFT JOIN movimientos ON espacio_id = $1 GROUP BY hoy.d`,
      [espacioId, ZONA],
    )
  ).rows[0];
  // Lo que entró y salió cada día del mes, hasta hoy: alimenta el gráfico de ingresos y egresos del Inicio.
  const diasMes = (
    await c.query(
      `WITH hoy AS (SELECT (now() AT TIME ZONE $2)::date AS d)
       SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha,
              coalesce(sum(monto_ars) FILTER (WHERE tipo = 'ingreso'), 0)::text AS ingresos,
              coalesce(sum(monto_ars) FILTER (WHERE tipo = 'egreso'), 0)::text AS egresos
       FROM movimientos, hoy
       WHERE espacio_id = $1 AND fecha <= hoy.d AND date_trunc('month', fecha) = date_trunc('month', hoy.d)
       GROUP BY fecha ORDER BY fecha`,
      [espacioId, ZONA],
    )
  ).rows.map((f) => ({ fecha: f.fecha as string, ingresos: Number(f.ingresos), egresos: Number(f.egresos) }));
  return {
    hoy: hoyArgentina(),
    saldo: Number(totales.saldo),
    ingresosMes: Number(totales.ingresos_mes),
    egresosMes: Number(totales.egresos_mes),
    diasMes,
    registrosMes: await registrosDelMes(c),
    limiteRegistrosMes: await limiteDelPlan(c, usuarioId),
  };
}

/** Cuenta por fecha de carga, no por la fecha del movimiento: cargar en meses pasados no evita el límite. */
async function registrosDelMes(c: pg.PoolClient): Promise<number> {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM movimientos
     WHERE date_trunc('month', creado_en AT TIME ZONE $1) = date_trunc('month', now() AT TIME ZONE $1)`,
    [ZONA],
  );
  return rows[0].n;
}

async function limiteDelPlan(c: pg.PoolClient, usuarioId: string): Promise<number | null> {
  const { rows } = await c.query(
    'SELECT p.limite_registros_mes AS limite FROM suscripciones s JOIN planes p ON p.codigo = s.plan_codigo WHERE s.usuario_id = $1',
    [usuarioId],
  );
  return rows[0].limite;
}

export function rutasEspacios(): Router {
  const router = Router();
  router.use('/espacios', requerirSesion);
  router.use(rutasCaja());
  router.use(rutasCompromisos());
  router.use(rutasInformes());

  router.get('/espacios/:espacioId/movimientos', async (req, res) => {
    const { desde, hasta, tipo } = validar(filtroMovimientos, req.query);
    const datos = await conUsuario(req.usuario.id, async (c) => {
      const espacioId = await espacioPropio(c, req);
      // Los filtros vacíos no restringen nada. Todo va parametrizado.
      const donde = `espacio_id = $1 AND ($2::date IS NULL OR fecha >= $2) AND ($3::date IS NULL OR fecha <= $3) AND ($4::text IS NULL OR tipo = $4)`;
      const parametros = [espacioId, desde ?? null, hasta ?? null, tipo ?? null];
      const { rows } = await c.query(
        `SELECT id, tipo, monto_ars::text AS monto, concepto, categoria, to_char(fecha, 'YYYY-MM-DD') AS fecha
         FROM movimientos WHERE ${donde} ORDER BY movimientos.fecha DESC, creado_en DESC LIMIT ${MAXIMO_LISTA + 1}`,
        parametros,
      );
      const totales = (
        await c.query(
          `SELECT count(*)::int AS cantidad,
                  coalesce(sum(monto_ars) FILTER (WHERE tipo = 'ingreso'), 0)::text AS ingresos,
                  coalesce(sum(monto_ars) FILTER (WHERE tipo = 'egreso'), 0)::text AS egresos
           FROM movimientos WHERE ${donde}`,
          parametros,
        )
      ).rows[0];
      return {
        movimientos: rows.slice(0, MAXIMO_LISTA).map((m) => ({ ...m, monto: Number(m.monto) })),
        filtro: { cantidad: totales.cantidad, ingresos: Number(totales.ingresos), egresos: Number(totales.egresos), recortado: rows.length > MAXIMO_LISTA },
        resumen: await resumen(c, espacioId, req.usuario.id),
      };
    });
    res.json(datos);
  });

  router.post('/espacios/:espacioId/movimientos', async (req, res) => {
    const { tipo, monto, concepto, categoria, fecha } = validar(movimientoNuevo, req.body);
    const id = await conUsuario(req.usuario.id, async (c) => {
      const espacioId = await espacioPropio(c, req);
      // El candado evita que dos cargas simultáneas se pasen del límite del plan.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [req.usuario.id]);
      const limite = await limiteDelPlan(c, req.usuario.id);
      if (limite !== null && (await registrosDelMes(c)) >= limite) {
        throw new ErrorHttp(403, { error: `Llegaste a los ${limite} registros de este mes en tu plan.`, codigo: 'limite_plan' });
      }
      const { rows } = await c.query(
        'INSERT INTO movimientos (espacio_id, tipo, monto_ars, concepto, categoria, fecha) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [espacioId, tipo, monto, concepto, categoria, fecha],
      );
      return rows[0].id as string;
    });
    res.status(201).json({ id });
  });

  router.post('/espacios/:espacioId/movimientos/importar', async (req, res) => {
    const { filas } = validar(importacion, req.body);
    const resultado = await conUsuario(req.usuario.id, async (c) => {
      const espacioId = await espacioPropio(c, req);
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [req.usuario.id]);

      // Cada fila ya cargada "descuenta" una igual del archivo. Así, volver a importar la misma
      // planilla no duplica nada, y dos gastos iguales en un mismo día siguen siendo dos.
      const clave = (f: { fecha: string; tipo: string; monto: number | string; concepto: string }) => `${f.fecha}|${f.tipo}|${f.monto}|${f.concepto.trim().toLowerCase()}`;
      const { rows } = await c.query(
        `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, tipo, monto_ars::text AS monto, concepto FROM movimientos
         WHERE espacio_id = $1 AND fecha = ANY ($2::date[])`,
        [espacioId, [...new Set(filas.map((f) => f.fecha))]],
      );
      const existentes = new Map<string, number>();
      for (const f of rows) existentes.set(clave(f), (existentes.get(clave(f)) ?? 0) + 1);
      const nuevas = filas.filter((f) => {
        const k = clave(f);
        const restantes = existentes.get(k) ?? 0;
        if (restantes > 0) {
          existentes.set(k, restantes - 1);
          return false;
        }
        return true;
      });

      // El límite del plan se aplica igual que al cargar a mano: entra todo o no entra nada.
      const limite = await limiteDelPlan(c, req.usuario.id);
      if (limite !== null) {
        const cupo = limite - (await registrosDelMes(c));
        if (nuevas.length > cupo) {
          throw new ErrorHttp(403, {
            error: `El archivo trae ${nuevas.length} movimientos nuevos y a tu plan le quedan ${Math.max(cupo, 0)} registros este mes. Importá un archivo más chico o elegí menos filas.`,
            codigo: 'limite_plan',
          });
        }
      }

      const importacionId = nuevas.length > 0 ? randomUUID() : null;
      if (nuevas.length > 0) {
        await c.query(
          `INSERT INTO movimientos (espacio_id, tipo, monto_ars, concepto, categoria, fecha, importacion_id)
           SELECT $1, f.tipo, f.monto, f.concepto, f.categoria, f.fecha, $3
           FROM jsonb_to_recordset($2::jsonb) AS f(tipo text, monto bigint, concepto text, categoria text, fecha date)`,
          [espacioId, JSON.stringify(nuevas), importacionId],
        );
      }
      return { importados: nuevas.length, repetidos: filas.length - nuevas.length, importacionId };
    });
    res.status(201).json(resultado);
  });

  router.delete('/espacios/:espacioId/importaciones/:importacionId', async (req, res) => {
    const importacionId = idValido(req.params.importacionId);
    const borrados = await conUsuario(req.usuario.id, async (c) => {
      const espacioId = await espacioPropio(c, req);
      if (!importacionId) return 0;
      return (await c.query('DELETE FROM movimientos WHERE importacion_id = $1 AND espacio_id = $2', [importacionId, espacioId])).rowCount ?? 0;
    });
    if (!borrados) {
      res.status(404).json({ error: 'No encontramos esa importación.' });
      return;
    }
    res.json({ borrados });
  });

  // Al borrar un movimiento queda guardado en eliminados (lo hace la base). Si era el pago de algo
  // agendado, ese pago vuelve a figurar como pendiente en Pagos y cobros futuros.
  router.delete('/espacios/:espacioId/movimientos/:movimientoId', async (req, res) => {
    const movimientoId = idValido(req.params.movimientoId);
    const resultado = await conUsuario(req.usuario.id, async (c) => {
      const espacioId = await espacioPropio(c, req);
      const borrado = movimientoId
        ? (await c.query('DELETE FROM movimientos WHERE id = $1 AND espacio_id = $2 RETURNING compromiso_id, concepto', [movimientoId, espacioId])).rows[0]
        : null;
      if (!borrado) throw new ErrorHttp(404, { error: 'No encontramos ese movimiento.' });
      const volvioAPendiente = borrado.compromiso_id ? await revertirPago(c, espacioId, borrado.compromiso_id) : false;
      return { volvioAPendiente, concepto: borrado.concepto as string };
    });
    res.json(resultado);
  });

  router.get('/espacios/:espacioId/movimientos-eliminados', async (req, res) => {
    const lista = await conUsuario(req.usuario.id, async (c) => {
      const espacioId = await espacioPropio(c, req);
      const { rows } = await c.query(
        `SELECT id, tipo, monto_ars::text AS monto, concepto, categoria, to_char(fecha, 'YYYY-MM-DD') AS fecha, compromiso_id IS NOT NULL AS de_agenda,
                to_char(eliminado_en AT TIME ZONE '${ZONA}', 'YYYY-MM-DD') AS eliminado
         FROM movimientos_eliminados WHERE espacio_id = $1 ORDER BY eliminado_en DESC LIMIT 50`,
        [espacioId],
      );
      return { eliminados: rows.map((f) => ({ id: f.id, tipo: f.tipo, monto: Number(f.monto), concepto: f.concepto, categoria: f.categoria, fecha: f.fecha, deAgenda: f.de_agenda, eliminado: f.eliminado })) };
    });
    res.json(lista);
  });

  // Restaurar vuelve a poner el movimiento tal cual. Si era un pago agendado, vuelve a figurar como pagado.
  router.post('/espacios/:espacioId/movimientos-eliminados/:movimientoId/restaurar', async (req, res) => {
    const movimientoId = idValido(req.params.movimientoId);
    await conUsuario(req.usuario.id, async (c) => {
      const espacioId = await espacioPropio(c, req);
      const fila = movimientoId
        ? (await c.query('DELETE FROM movimientos_eliminados WHERE id = $1 AND espacio_id = $2 RETURNING *', [movimientoId, espacioId])).rows[0]
        : null;
      if (!fila) throw new ErrorHttp(404, { error: 'No encontramos ese movimiento eliminado.' });
      const compromisoId: string | null = fila.compromiso_id;
      // Si mientras tanto ese pago se volvió a registrar (o se anuló), no se restaura para no contarlo dos veces.
      if (compromisoId && !(await volverAPagar(c, espacioId, compromisoId))) {
        throw new ErrorHttp(409, { error: 'Ese pago ya se volvió a registrar en Pagos y cobros futuros. Si lo restaurás, quedaría contado dos veces.' });
      }
      await c.query(
        'INSERT INTO movimientos (id, espacio_id, tipo, monto_ars, concepto, categoria, fecha, compromiso_id, importacion_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [fila.id, espacioId, fila.tipo, fila.monto_ars, fila.concepto, fila.categoria, fila.fecha, compromisoId, fila.importacion_id],
      );
    });
    res.status(204).end();
  });

  return router;
}
