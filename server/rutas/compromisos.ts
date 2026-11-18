import { Router, type Request } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { diasEntre, proyectar } from '../../shared/motor';
import { datosDeCaja, ErrorHttp, espacioPropio, exigirModulo, hoyArgentina, idValido, validar } from '../acceso';
import { conUsuario } from '../db';

const nuevo = z.object({
  tipo: z.enum(['pago', 'cobro']),
  monto: z.number().int('El monto va sin centavos.').positive('Escribí un monto mayor a cero.').max(1_000_000_000_000),
  concepto: z.string().trim().min(1, 'Escribí un concepto.').max(120),
  categoria: z.string().trim().min(1, 'Elegí una categoría.').max(60),
  fecha: z.iso.date('Revisá la fecha.'),
  mensual: z.boolean().default(false),
  avisoDias: z.number().int().min(0).max(30).default(2),
});

const NO_ENCONTRADO = { error: 'No encontramos ese pago o cobro. Puede que ya esté registrado.' };

async function abrir(c: pg.PoolClient, req: Request): Promise<{ espacioId: string; compromisoId: string }> {
  const espacioId = await espacioPropio(c, req);
  await exigirModulo(c, req, 'vencimientos');
  const compromisoId = idValido(req.params.compromisoId);
  if (!compromisoId) throw new ErrorHttp(404, NO_ENCONTRADO);
  return { espacioId, compromisoId };
}

/**
 * Deshace el pago de algo agendado: vuelve a figurar como pendiente (se debe o se espera cobrar)
 * y, si era mensual, se saca el próximo que se había agendado solo y todavía no se pagó.
 * El movimiento lo borra quien llama (o ya lo borró).
 */
export async function revertirPago(c: pg.PoolClient, espacioId: string, compromisoId: string): Promise<boolean> {
  const { rowCount } = await c.query(
    `UPDATE compromisos SET estado = 'pendiente', pagado_en = NULL WHERE id = $1 AND espacio_id = $2 AND estado = 'pagado'`,
    [compromisoId, espacioId],
  );
  if (!rowCount) return false;
  await c.query(`DELETE FROM compromisos WHERE generado_por = $1 AND espacio_id = $2 AND estado = 'pendiente'`, [compromisoId, espacioId]);
  return true;
}

/** Vuelve a marcar como pagado algo agendado (al restaurar el movimiento de su pago). */
export async function volverAPagar(c: pg.PoolClient, espacioId: string, compromisoId: string): Promise<boolean> {
  const { rows } = await c.query(
    `UPDATE compromisos SET estado = 'pagado', pagado_en = now()
     WHERE id = $1 AND espacio_id = $2 AND estado = 'pendiente'
     RETURNING tipo, monto_ars, concepto, categoria, mensual, aviso_dias, fecha`,
    [compromisoId, espacioId],
  );
  const pagado = rows[0];
  if (!pagado) return false;
  if (pagado.mensual) await agendarProximo(c, espacioId, compromisoId, pagado);
  return true;
}

async function agendarProximo(
  c: pg.PoolClient,
  espacioId: string,
  compromisoId: string,
  pagado: { tipo: string; monto_ars: string; concepto: string; categoria: string; fecha: string; aviso_dias: number },
): Promise<void> {
  await c.query(
    `INSERT INTO compromisos (espacio_id, tipo, monto_ars, concepto, categoria, fecha, mensual, aviso_dias, generado_por)
     VALUES ($1, $2, $3, $4, $5, ($6::date + interval '1 month')::date, true, $7, $8)`,
    [espacioId, pagado.tipo, pagado.monto_ars, pagado.concepto, pagado.categoria, pagado.fecha, pagado.aviso_dias, compromisoId],
  );
}

export function rutasCompromisos(): Router {
  const router = Router();

  router.get('/espacios/:espacioId/compromisos', async (req, res) => {
    const respuesta = await conUsuario(req.usuario.id, async (c) => {
      const espacioId = await espacioPropio(c, req);
      await exigirModulo(c, req, 'vencimientos');
      const hoy = hoyArgentina();
      const datos = await datosDeCaja(c, espacioId, hoy);
      const proyeccion = datos ? proyectar(datos) : null;
      const { rows } = await c.query(
        `SELECT id, tipo, monto_ars::text AS monto, concepto, categoria, to_char(fecha, 'YYYY-MM-DD') AS fecha, mensual, aviso_dias
         FROM compromisos WHERE espacio_id = $1 AND estado = 'pendiente' ORDER BY compromisos.fecha, creado_en LIMIT 300`,
        [espacioId],
      );
      const saldoEseDia = (dias: number) => (proyeccion && dias >= 1 && dias <= 30 ? proyeccion[dias] : null);
      const agendados = rows.map((f) => {
        const dias = diasEntre(hoy, f.fecha);
        return {
          id: f.id,
          origen: 'agenda' as const,
          tipo: f.tipo,
          monto: Number(f.monto),
          concepto: f.concepto,
          categoria: f.categoria,
          fecha: f.fecha,
          mensual: f.mensual,
          avisoDias: f.aviso_dias,
          dias,
          saldoEseDia: saldoEseDia(dias),
        };
      });
      // Los movimientos con fecha futura también se muestran: se descuentan solos cuando llega el día.
      const programados = (datos?.compromisos ?? [])
        .filter((x) => x.automatico)
        .map((x) => {
          const dias = diasEntre(hoy, x.fecha);
          return {
            id: x.id,
            origen: 'movimiento' as const,
            tipo: x.monto < 0 ? ('pago' as const) : ('cobro' as const),
            monto: Math.abs(x.monto),
            concepto: x.concepto,
            categoria: x.categoria,
            fecha: x.fecha,
            mensual: false,
            avisoDias: x.avisoDias,
            dias,
            saldoEseDia: saldoEseDia(dias),
          };
        });
      return { hoy, compromisos: [...agendados, ...programados].sort((a, b) => a.fecha.localeCompare(b.fecha)) };
    });
    res.json(respuesta);
  });

  router.post('/espacios/:espacioId/compromisos', async (req, res) => {
    const d = validar(nuevo, req.body);
    const id = await conUsuario(req.usuario.id, async (c) => {
      const espacioId = await espacioPropio(c, req);
      await exigirModulo(c, req, 'vencimientos');
      const { rows } = await c.query(
        `INSERT INTO compromisos (espacio_id, tipo, monto_ars, concepto, categoria, fecha, mensual, aviso_dias)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [espacioId, d.tipo, d.monto, d.concepto, d.categoria, d.fecha, d.mensual, d.avisoDias],
      );
      return rows[0].id;
    });
    res.status(201).json({ id });
  });

  // Marcar pagado mueve la plata de verdad: crea el movimiento y, si es mensual, agenda el próximo.
  router.post('/espacios/:espacioId/compromisos/:compromisoId/pagar', async (req, res) => {
    await conUsuario(req.usuario.id, async (c) => {
      const { espacioId, compromisoId } = await abrir(c, req);
      // La condición sobre el estado impide registrar dos veces el mismo pago.
      const { rows } = await c.query(
        `UPDATE compromisos SET estado = 'pagado', pagado_en = now()
         WHERE id = $1 AND espacio_id = $2 AND estado = 'pendiente'
         RETURNING tipo, monto_ars, concepto, categoria, mensual, aviso_dias, fecha`,
        [compromisoId, espacioId],
      );
      const pagado = rows[0];
      if (!pagado) throw new ErrorHttp(404, NO_ENCONTRADO);
      await c.query('INSERT INTO movimientos (espacio_id, tipo, monto_ars, concepto, categoria, fecha, compromiso_id) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
        espacioId,
        pagado.tipo === 'pago' ? 'egreso' : 'ingreso',
        pagado.monto_ars,
        pagado.concepto,
        pagado.categoria,
        hoyArgentina(),
        compromisoId,
      ]);
      if (pagado.mensual) await agendarProximo(c, espacioId, compromisoId, pagado);
    });
    res.status(204).end();
  });

  router.post('/espacios/:espacioId/compromisos/:compromisoId/reprogramar', async (req, res) => {
    const { dias } = validar(z.object({ dias: z.number().int().min(1).max(90) }), req.body);
    await conUsuario(req.usuario.id, async (c) => {
      const { espacioId, compromisoId } = await abrir(c, req);
      const { rowCount } = await c.query(
        `UPDATE compromisos SET fecha = fecha + $3::int WHERE id = $1 AND espacio_id = $2 AND estado = 'pendiente'`,
        [compromisoId, espacioId, dias],
      );
      if (!rowCount) throw new ErrorHttp(404, NO_ENCONTRADO);
    });
    res.status(204).end();
  });

  // Eliminar no borra: queda "anulado" en el historial y se puede volver a agendar.
  router.delete('/espacios/:espacioId/compromisos/:compromisoId', async (req, res) => {
    await conUsuario(req.usuario.id, async (c) => {
      const { espacioId, compromisoId } = await abrir(c, req);
      const { rowCount } = await c.query(
        `UPDATE compromisos SET estado = 'anulado', anulado_en = now() WHERE id = $1 AND espacio_id = $2 AND estado = 'pendiente'`,
        [compromisoId, espacioId],
      );
      if (!rowCount) throw new ErrorHttp(404, NO_ENCONTRADO);
    });
    res.status(204).end();
  });

  router.post('/espacios/:espacioId/compromisos/:compromisoId/restaurar', async (req, res) => {
    await conUsuario(req.usuario.id, async (c) => {
      const { espacioId, compromisoId } = await abrir(c, req);
      const { rowCount } = await c.query(
        `UPDATE compromisos SET estado = 'pendiente', anulado_en = NULL WHERE id = $1 AND espacio_id = $2 AND estado = 'anulado'`,
        [compromisoId, espacioId],
      );
      if (!rowCount) throw new ErrorHttp(404, NO_ENCONTRADO);
    });
    res.status(204).end();
  });

  // Deshacer un pago: se borra el movimiento que generó (queda en eliminados) y vuelve a pendiente.
  router.post('/espacios/:espacioId/compromisos/:compromisoId/deshacer-pago', async (req, res) => {
    await conUsuario(req.usuario.id, async (c) => {
      const { espacioId, compromisoId } = await abrir(c, req);
      if (!(await revertirPago(c, espacioId, compromisoId))) throw new ErrorHttp(404, NO_ENCONTRADO);
      await c.query('DELETE FROM movimientos WHERE compromiso_id = $1 AND espacio_id = $2', [compromisoId, espacioId]);
    });
    res.status(204).end();
  });

  // Lo que ya se pagó o cobró y lo que se eliminó de la agenda.
  router.get('/espacios/:espacioId/compromisos/historial', async (req, res) => {
    const historial = await conUsuario(req.usuario.id, async (c) => {
      const espacioId = await espacioPropio(c, req);
      await exigirModulo(c, req, 'vencimientos');
      const { rows } = await c.query(
        `SELECT id, tipo, monto_ars::text AS monto, concepto, categoria, to_char(fecha, 'YYYY-MM-DD') AS fecha, estado, mensual,
                to_char(coalesce(pagado_en, anulado_en) AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') AS cuando
         FROM compromisos WHERE espacio_id = $1 AND estado IN ('pagado', 'anulado')
         ORDER BY coalesce(pagado_en, anulado_en) DESC LIMIT 100`,
        [espacioId],
      );
      return { historial: rows.map((f) => ({ ...f, monto: Number(f.monto) })) };
    });
    res.json(historial);
  });

  return router;
}
