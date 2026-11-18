import { Router } from 'express';
import { z } from 'zod';
import { diasEntre, evaluar, fraseRespuesta, proyectar } from '../../shared/motor';
import { datosDeCaja, espacioPropio, exigirModulo, hoyArgentina, validar } from '../acceso';
import { conUsuario } from '../db';

const periodo = z
  .object({ desde: z.iso.date('Revisá la fecha desde.'), hasta: z.iso.date('Revisá la fecha hasta.') })
  .refine((p) => p.desde <= p.hasta, { message: 'La fecha desde tiene que ser anterior a la fecha hasta.' })
  .refine((p) => diasEntre(p.desde, p.hasta) <= 366 * 2, { message: 'Elegí un período de hasta 2 años.' });

const MAXIMO_MOVIMIENTOS = 5000;

/** Informe con los movimientos de un período, tu plata a 30 días y los pagos y cobros que vienen. */
export function rutasInformes(): Router {
  const router = Router();

  router.get('/espacios/:espacioId/informe', async (req, res) => {
    const { desde, hasta } = validar(periodo, req.query);
    const informe = await conUsuario(req.usuario.id, async (c) => {
      const espacioId = await espacioPropio(c, req);
      await exigirModulo(c, req, 'informes');
      const hoy = hoyArgentina();

      const espacio = (await c.query('SELECT nombre FROM espacios_trabajo WHERE id = $1', [espacioId])).rows[0];
      const perfil = (await c.query('SELECT nombre, apellido FROM perfiles WHERE usuario_id = $1', [req.usuario.id])).rows[0];

      const filas = (
        await c.query(
          `SELECT tipo, monto_ars::text AS monto, concepto, categoria, to_char(fecha, 'YYYY-MM-DD') AS fecha
           FROM movimientos WHERE espacio_id = $1 AND fecha BETWEEN $2 AND $3
           ORDER BY movimientos.fecha, creado_en LIMIT ${MAXIMO_MOVIMIENTOS + 1}`,
          [espacioId, desde, hasta],
        )
      ).rows;
      const movimientos = filas.slice(0, MAXIMO_MOVIMIENTOS).map((m) => ({ ...m, monto: Number(m.monto), programado: m.fecha > hoy }));
      const ingresos = movimientos.filter((m) => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0);
      const egresos = movimientos.filter((m) => m.tipo === 'egreso').reduce((s, m) => s + m.monto, 0);
      const categorias = new Map<string, { tipo: string; categoria: string; total: number; cantidad: number }>();
      for (const m of movimientos) {
        const clave = `${m.tipo}|${m.categoria}`;
        const actual = categorias.get(clave) ?? { tipo: m.tipo, categoria: m.categoria, total: 0, cantidad: 0 };
        actual.total += m.monto;
        actual.cantidad += 1;
        categorias.set(clave, actual);
      }

      const datos = await datosDeCaja(c, espacioId, hoy);
      let caja = null;
      if (datos) {
        const proyeccion = proyectar(datos);
        const evaluacion = evaluar(datos, proyeccion);
        caja = {
          saldo: datos.saldo,
          reserva: datos.reserva,
          ventaDiaria: datos.ventaDiaria,
          gastoDiario: datos.gastoDiario,
          minimo: { dia: evaluacion.minimo.d, saldo: evaluacion.minimo.v },
          nivel: evaluacion.nivel,
          frase: fraseRespuesta(datos, evaluacion),
          // proyeccion[0] es hoy; el informe muestra los próximos 30 días.
          dias: proyeccion.map((saldo, i) => ({ dia: i, saldo })),
        };
      }

      const agendados = (
        await c.query(
          `SELECT tipo, monto_ars::text AS monto, concepto, categoria, to_char(fecha, 'YYYY-MM-DD') AS fecha, mensual
           FROM compromisos WHERE espacio_id = $1 AND estado = 'pendiente' ORDER BY compromisos.fecha LIMIT 500`,
          [espacioId],
        )
      ).rows.map((f) => ({ tipo: f.tipo as 'pago' | 'cobro', monto: Number(f.monto), concepto: f.concepto, categoria: f.categoria, fecha: f.fecha, mensual: f.mensual, origen: 'agenda' as const }));
      const programados = (datos?.compromisos ?? [])
        .filter((x) => x.automatico)
        .map((x) => ({ tipo: x.monto < 0 ? ('pago' as const) : ('cobro' as const), monto: Math.abs(x.monto), concepto: x.concepto, categoria: x.categoria, fecha: x.fecha, mensual: false, origen: 'movimiento' as const }));
      const futuros = [...agendados, ...programados].sort((a, b) => a.fecha.localeCompare(b.fecha));

      return {
        generado: hoy,
        periodo: { desde, hasta },
        espacio: espacio.nombre,
        titular: [perfil.nombre, perfil.apellido].filter(Boolean).join(' '),
        movimientos: {
          lista: movimientos,
          recortado: filas.length > MAXIMO_MOVIMIENTOS,
          totales: { ingresos, egresos, neto: ingresos - egresos, cantidad: movimientos.length },
          categorias: [...categorias.values()].sort((a, b) => a.tipo.localeCompare(b.tipo) || b.total - a.total),
        },
        caja,
        futuros: {
          lista: futuros,
          pagos: futuros.filter((f) => f.tipo === 'pago').reduce((s, f) => s + f.monto, 0),
          cobros: futuros.filter((f) => f.tipo === 'cobro').reduce((s, f) => s + f.monto, 0),
        },
      };
    });
    res.json(informe);
  });

  return router;
}
