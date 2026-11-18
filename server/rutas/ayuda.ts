import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { respuestaPrevia, responder, type ContextoAyuda } from '../../shared/ayuda';
import { validar } from '../acceso';
import { conUsuario } from '../db';
import { iaDisponible, preguntarGemini } from '../gemini';
import { requerirSesion } from '../sesion';

const pedido = z.object({
  pregunta: z.string().trim().min(1, 'Escribí tu pregunta.').max(300, 'La pregunta es demasiado larga.'),
  historial: z
    .array(z.object({ autor: z.enum(['usuario', 'clara']), texto: z.string().max(1000) }))
    .max(6)
    .default([]),
});

async function contextoDe(req: Request): Promise<ContextoAyuda> {
  return conUsuario(req.usuario.id, async (c) => {
    const plan = (
      await c.query('SELECT p.nombre, p.modulos FROM suscripciones s JOIN planes p ON p.codigo = s.plan_codigo WHERE s.usuario_id = $1', [req.usuario.id])
    ).rows[0];
    const planes = (await c.query('SELECT nombre, modulos FROM planes ORDER BY orden')).rows as { nombre: string; modulos: string[] }[];
    return {
      tipo: req.usuario.tipo,
      plan: plan.nombre,
      modulos: plan.modulos,
      planDe: (modulo) => planes.find((p) => p.modulos.includes(modulo))?.nombre ?? 'Intermedio',
    };
  });
}

export function rutasAyuda({ limitePorUsuario = 30 } = {}): Router {
  const router = Router();

  // Cada pregunta a Gemini tiene un costo. Pasado el límite la ayuda sigue, con la guía local.
  const limitador = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: limitePorUsuario,
    keyGenerator: (req) => req.usuario.id,
    standardHeaders: false,
    legacyHeaders: false,
    handler: (_req, res, next) => {
      res.locals.sinIA = true;
      next();
    },
  });

  // La IA es del plan que incluye el módulo "asistente". Los demás planes usan la guía de la app.
  router.get('/ayuda/estado', requerirSesion, async (req, res) => {
    if (!iaDisponible()) {
      res.json({ ia: false });
      return;
    }
    const ctx = await contextoDe(req);
    const enPlan = ctx.modulos.includes('asistente');
    res.json(enPlan ? { ia: true } : { ia: false, planIA: ctx.planDe('asistente') });
  });

  router.post('/ayuda', requerirSesion, limitador, async (req, res) => {
    const { pregunta, historial } = validar(pedido, req.body);
    const ctx = await contextoDe(req);

    // Saludos y gracias se resuelven acá. Los pedidos de consejo van a Gemini, que explica criterios
    // sin decir qué hacer; si Gemini no está, la guía responde con la negativa de siempre.
    const conIA = iaDisponible() && ctx.modulos.includes('asistente') && !res.locals.sinIA;
    const previa = respuestaPrevia(pregunta);
    if (previa && (previa.tema !== 'consejo' || !conIA)) {
      res.json({ ...previa, origen: 'local' });
      return;
    }
    const deIA = conIA ? await preguntarGemini(pregunta, historial, ctx) : null;
    if (deIA) {
      res.json({ ...deIA, origen: 'gemini' });
      return;
    }
    const local = responder(pregunta, ctx);
    // Si Gemini no pudo contestar una pregunta que la guía tampoco sabe, se dice la verdad: fue un problema de conexión.
    if (conIA && local.tema === 'sin_respuesta') {
      local.texto = 'Ahora no pude conectarme con Gemini para desarrollar esa pregunta. Probá de nuevo en un ratito. Mientras tanto, te puedo ayudar con el uso de la app:';
    } else if (iaDisponible() && !ctx.modulos.includes('asistente') && local.tema === 'sin_respuesta') {
      local.texto = `Con la guía de la app no sé responder eso. Las respuestas con IA a preguntas generales están en el plan ${ctx.planDe('asistente')}: podés cambiarlo en Configuración. Mientras tanto, te ayudo con el uso de la app:`;
      local.accion = { texto: 'Ver planes', ruta: '/configuracion' };
    }
    res.json({ ...local, origen: 'local' });
  });

  return router;
}
