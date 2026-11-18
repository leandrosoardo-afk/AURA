import { Router } from 'express';
import { z } from 'zod';
import { alertas, evaluar, fraseRespuesta, LIMITE_SEGURO, minimo, OPCIONES_CUOTAS, proyectar, simular, sumarDias, diasEntre, type Escenario } from '../../shared/motor';
import { calcularHistorial, calcularSalud } from '../../shared/salud';
import { datosDeCaja, diasDeMovimientos, ErrorHttp, espacioPropio, exigirModulo, hoyArgentina, validar } from '../acceso';
import { conUsuario } from '../db';

const importe = z.number().min(0, 'Los montos no pueden ser negativos.').max(1_000_000_000_000, 'El monto es demasiado grande.');

const parametros = z.object({ reserva: importe });

const escenario = z.enum(['base', 'conservador', 'estres']).catch('base');

const entradaSimulador = z
  .object({
    precio: z.number().int().positive('Escribí el precio.').max(1_000_000_000_000),
    anticipo: z.number().int().min(0).default(0),
    diaAnticipo: z.number().int().min(1).max(365).default(1),
    cuotas: z.number().refine((n) => OPCIONES_CUOTAS.includes(n), 'Elegí la cantidad de cuotas.'),
    tna: z.number({ error: 'Escribí la tasa anual. Si es sin interés, poné 0.' }).min(0).max(1000),
    diaCuota: z.number().int().min(1).max(90).default(30),
  })
  .refine((e) => e.anticipo < e.precio, { message: 'El anticipo tiene que ser menor que el precio.' });

const SIN_PARAMETROS = { error: 'Registrá movimientos o importá tu planilla de Excel para empezar.', codigo: 'sin_parametros' };

export function rutasCaja(): Router {
  const router = Router();

  router.get('/espacios/:espacioId/caja', async (req, res) => {
    const pedido: Escenario = escenario.parse(req.query.escenario);
    const respuesta = await conUsuario(req.usuario.id, async (c) => {
      const espacioId = await espacioPropio(c, req);
      if (pedido !== 'base') await exigirModulo(c, req, 'escenarios');
      const hoy = hoyArgentina();
      const datos = await datosDeCaja(c, espacioId, hoy);
      if (!datos) return { configurada: false as const };

      const proyeccion = proyectar(datos, pedido);
      const evaluacion = evaluar(datos, proyeccion);
      const { rows } = await c.query(
        'SELECT modulos FROM planes p JOIN suscripciones s ON s.plan_codigo = p.codigo WHERE s.usuario_id = $1',
        [req.usuario.id],
      );
      return {
        configurada: true as const,
        hoy,
        escenario: pedido,
        diasHistoria: datos.diasHistoria,
        parametros: { reserva: datos.reserva, margen: datos.margen, ventaDiaria: datos.ventaDiaria, gastoDiario: datos.gastoDiario },
        saldo: datos.saldo,
        proyeccion,
        minimo: evaluacion.minimo,
        nivel: evaluacion.nivel,
        razones: evaluacion.razones,
        frase: fraseRespuesta(datos, evaluacion),
        pagos7Dias: datos.compromisos.filter((x) => x.monto < 0 && diasEntre(hoy, x.fecha) <= 7).reduce((s, x) => s - x.monto, 0),
        // Un cobro atrasado no se cuenta: nadie garantiza que entre (igual que en la proyección).
        cobros7Dias: datos.compromisos.filter((x) => x.monto > 0 && diasEntre(hoy, x.fecha) >= 0 && diasEntre(hoy, x.fecha) <= 7).reduce((s, x) => s + x.monto, 0),
        cuotaSegura: datos.margen * LIMITE_SEGURO,
        alertas: rows[0].modulos.includes('alertas') ? alertas(datos, proyeccion) : null,
      };
    });
    res.json(respuesta);
  });

  router.get('/espacios/:espacioId/salud', async (req, res) => {
    const respuesta = await conUsuario(req.usuario.id, async (c) => {
      const espacioId = await espacioPropio(c, req);
      const hoy = hoyArgentina();
      const [dias, datos] = [await diasDeMovimientos(c, espacioId), await datosDeCaja(c, espacioId, hoy)];
      const reserva = datos?.reserva ?? 0;
      const minimoProyectado = datos ? minimo(proyectar(datos)).v : null;
      return { salud: calcularSalud(dias, hoy, reserva, minimoProyectado), historial: calcularHistorial(dias, hoy, reserva) };
    });
    res.json(respuesta);
  });

  router.put('/espacios/:espacioId/parametros', async (req, res) => {
    const p = validar(parametros, req.body);
    await conUsuario(req.usuario.id, async (c) => {
      const espacioId = await espacioPropio(c, req);
      await c.query(
        `INSERT INTO parametros_caja (espacio_id, reserva) VALUES ($1, $2)
         ON CONFLICT (espacio_id) DO UPDATE SET reserva = $2, actualizado_en = now()`,
        [espacioId, p.reserva],
      );
    });
    res.status(204).end();
  });

  router.post('/espacios/:espacioId/simulador', async (req, res) => {
    const entrada = validar(entradaSimulador, req.body);
    const resultado = await conUsuario(req.usuario.id, async (c) => {
      const espacioId = await espacioPropio(c, req);
      await exigirModulo(c, req, 'simulador');
      const datos = await datosDeCaja(c, espacioId, hoyArgentina());
      if (!datos) throw new ErrorHttp(409, SIN_PARAMETROS);
      return { ...simular(datos, entrada), hoy: datos.hoy, reserva: datos.reserva };
    });
    res.json(resultado);
  });

  router.post('/espacios/:espacioId/simulador/guardar', async (req, res) => {
    const entrada = validar(entradaSimulador, req.body);
    const extra = validar(
      z.object({ concepto: z.string().trim().min(1, 'Escribí qué querés comprar.').max(100), confirmarRojo: z.boolean().default(false) }),
      req.body,
    );
    const creados = await conUsuario(req.usuario.id, async (c) => {
      const espacioId = await espacioPropio(c, req);
      await exigirModulo(c, req, 'simulador');
      await exigirModulo(c, req, 'vencimientos');
      const hoy = hoyArgentina();
      const datos = await datosDeCaja(c, espacioId, hoy);
      if (!datos) throw new ErrorHttp(409, SIN_PARAMETROS);
      // El veredicto se recalcula acá: el navegador no puede evitar la doble confirmación.
      const r = simular(datos, entrada);
      if (r.nivel === 'rojo' && !extra.confirmarRojo) {
        throw new ErrorHttp(409, { error: 'Esta operación da rojo. Confirmá que querés guardarla igual.', codigo: 'requiere_confirmacion' });
      }
      const insertar = (monto: number, concepto: string, dias: number) =>
        c.query(`INSERT INTO compromisos (espacio_id, tipo, monto_ars, concepto, categoria, fecha) VALUES ($1, 'pago', $2, $3, 'Cuotas', $4)`, [
          espacioId,
          Math.round(monto),
          concepto,
          sumarDias(hoy, dias),
        ]);
      if (entrada.anticipo > 0) await insertar(entrada.anticipo, `${extra.concepto}: anticipo`, entrada.diaAnticipo);
      for (let k = 0; k < entrada.cuotas; k++) {
        await insertar(r.cuota, `${extra.concepto}: cuota ${k + 1} de ${entrada.cuotas}`, entrada.diaCuota + 30 * k);
      }
      return entrada.cuotas + (entrada.anticipo > 0 ? 1 : 0);
    });
    res.status(201).json({ creados });
  });

  return router;
}
