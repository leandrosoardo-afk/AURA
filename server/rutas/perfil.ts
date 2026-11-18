import { Router } from 'express';
import { z } from 'zod';
import { validar } from '../acceso';
import { conUsuario } from '../db';
import { requerirSesion } from '../sesion';

const texto = (mensaje: string, max = 60) => z.string().trim().min(1, mensaje).max(max, 'Es demasiado largo.');

const datosPerfil = z.object({
  nombre: texto('Escribí tu nombre.'),
  apellido: z.string().trim().max(60, 'Es demasiado largo.').optional().default(''),
  nombreNegocio: z.string().trim().max(80, 'Es demasiado largo.').optional(),
});

// La foto llega achicada desde el navegador como data URL. Solo se aceptan estos formatos.
const FOTO = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const TOPE_FOTO = 400_000;

/** Configuración del perfil: cada usuario solo puede tocar el suyo (lo identifica la sesión). */
export function rutasPerfil(): Router {
  const router = Router();
  router.use('/perfil', requerirSesion);
  router.use('/suscripcion', requerirSesion);

  router.put('/perfil', async (req, res) => {
    const datos = validar(datosPerfil, req.body);
    const { id, tipo } = req.usuario;
    await conUsuario(id, async (c) => {
      await c.query('UPDATE perfiles SET nombre = $1, apellido = $2 WHERE usuario_id = $3', [datos.nombre, datos.apellido || null, id]);
      // En una PyME el nombre del negocio también es el nombre de su espacio de trabajo.
      if (tipo === 'pyme' && datos.nombreNegocio) {
        await c.query('UPDATE perfiles SET nombre_negocio = $1 WHERE usuario_id = $2', [datos.nombreNegocio, id]);
        await c.query('UPDATE espacios_trabajo SET nombre = $1 WHERE usuario_id = $2', [datos.nombreNegocio, id]);
      }
    });
    res.json({ ok: true });
  });

  router.put('/perfil/foto', async (req, res) => {
    const foto = typeof req.body?.foto === 'string' ? req.body.foto : '';
    if (!FOTO.test(foto) || foto.length > TOPE_FOTO) {
      res.status(400).json({ error: 'Elegí una imagen JPG, PNG o WebP.' });
      return;
    }
    await conUsuario(req.usuario.id, (c) => c.query('UPDATE perfiles SET foto = $1 WHERE usuario_id = $2', [foto, req.usuario.id]));
    res.json({ ok: true });
  });

  router.delete('/perfil/foto', async (req, res) => {
    await conUsuario(req.usuario.id, (c) => c.query('UPDATE perfiles SET foto = NULL WHERE usuario_id = $1', [req.usuario.id]));
    res.json({ ok: true });
  });

  router.get('/perfil/foto', async (req, res) => {
    const fila = await conUsuario(req.usuario.id, async (c) => (await c.query('SELECT foto FROM perfiles WHERE usuario_id = $1', [req.usuario.id])).rows[0]);
    const partes = typeof fila?.foto === 'string' ? FOTO.exec(fila.foto) : null;
    if (!partes) {
      res.status(404).json({ error: 'No tenés foto.' });
      return;
    }
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.type(`image/${partes[1]}`).send(Buffer.from(partes[2], 'base64'));
  });

  // Cambiar de plan: subir o bajar. No hay cobro, así que alcanza con que el plan exista.
  router.put('/suscripcion', async (req, res) => {
    const { plan } = validar(z.object({ plan: z.string().max(40) }), req.body);
    const { id } = req.usuario;
    const resultado = await conUsuario(id, async (c) => {
      const existe = (await c.query('SELECT 1 FROM planes WHERE codigo = $1', [plan])).rowCount;
      if (!existe) return null;
      await c.query('UPDATE suscripciones SET plan_codigo = $1, cambiado_en = now() WHERE usuario_id = $2', [plan, id]);
      return plan;
    });
    if (!resultado) {
      res.status(400).json({ error: 'Ese plan no existe.' });
      return;
    }
    res.json({ ok: true, plan: resultado });
  });

  return router;
}
