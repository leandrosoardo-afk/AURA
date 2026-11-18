import bcrypt from 'bcryptjs';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { adaptarInterfaz } from '../../shared/adaptacion';
import { PREGUNTAS, type Respuestas, type TipoUsuario } from '../../shared/cuestionario';
import { config } from '../config';
import { correoDeRecupero, enviarCorreo } from '../correo';
import { conUsuario, pool } from '../db';
import { abrirSesion, cerrarSesion, requerirSesion, sesionActual } from '../sesion';
import { createHash, randomBytes, randomUUID } from 'crypto';

const COSTO_BCRYPT = 12;
// Se compara contra este hash si el email no existe, para que la respuesta tarde lo mismo.
const HASH_FICTICIO = bcrypt.hashSync(randomUUID(), COSTO_BCRYPT);

const email = z.string().trim().toLowerCase().pipe(z.email('Revisá el email.')).pipe(z.string().max(254));

// bcrypt solo usa los primeros 72 bytes: más largo daría una falsa sensación de seguridad.
const claveNueva = z
  .string()
  .min(8, 'La contraseña necesita al menos 8 caracteres.')
  .refine((v) => Buffer.byteLength(v) <= 72, 'La contraseña es demasiado larga.');

const DURACION_RECUPERACION_MS = 60 * 60 * 1000;

const registroBase = z.object({
  tipo: z.enum(['pyme', 'persona']),
  nombre: z.string().trim().min(1, 'Escribí tu nombre.').max(80),
  nombreNegocio: z.string().trim().max(80).optional(),
  email,
  clave: claveNueva,
  plan: z.string(),
  respuestas: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
});

/** Devuelve las respuestas limpias, o null si falta alguna o no es una opción válida. */
function validarRespuestas(tipo: TipoUsuario, respuestas: Respuestas): Respuestas | null {
  const preguntas = PREGUNTAS[tipo];
  if (Object.keys(respuestas).some((id) => !preguntas.some((p) => p.id === id))) return null;
  const limpias: Respuestas = {};
  for (const pregunta of preguntas) {
    const valor = respuestas[pregunta.id];
    const validas = pregunta.opciones.map((o) => o.valor);
    if (pregunta.multiple) {
      if (!Array.isArray(valor) || valor.length === 0 || valor.some((v) => !validas.includes(v))) return null;
      limpias[pregunta.id] = [...new Set(valor)];
    } else {
      if (typeof valor !== 'string' || !validas.includes(valor)) return null;
      limpias[pregunta.id] = valor;
    }
  }
  return limpias;
}

export function rutasAuth(limitar: boolean): Router {
  const router = Router();
  const limitador = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: limitar ? 20 : 0,
    skip: () => !limitar,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Probá de nuevo en 15 minutos.' },
  });
  // Además del tope por IP, un tope por cuenta: frena a quien prueba contraseñas desde muchas IP.
  const porCuenta = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: limitar ? 10 : 0,
    skip: () => !limitar,
    keyGenerator: (req) => `cuenta:${String(req.body?.email ?? '').trim().toLowerCase().slice(0, 200)}`,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos con esta cuenta. Probá de nuevo en 15 minutos o recuperá tu contraseña.' },
  });

  /**
   * Protección contra bots en los formularios públicos: un campo oculto que una persona nunca completa
   * ("sitio") y el tiempo que tardó en llenar el formulario ("demora", en milisegundos).
   */
  const pareceBot = (cuerpo: unknown): boolean => {
    const c = (cuerpo ?? {}) as { sitio?: unknown; demora?: unknown };
    if (typeof c.sitio === 'string' && c.sitio.trim() !== '') return true;
    return typeof c.demora === 'number' && c.demora < 1500;
  };

  router.post('/auth/registro', limitador, async (req, res) => {
    if (pareceBot(req.body)) {
      res.status(400).json({ error: 'No pudimos crear la cuenta. Esperá unos segundos y probá de nuevo.' });
      return;
    }
    const datos = registroBase.safeParse(req.body);
    if (!datos.success) {
      res.status(400).json({ error: datos.error.issues[0].message });
      return;
    }
    const { tipo, nombre, nombreNegocio, email, clave, plan } = datos.data;
    if (tipo === 'pyme' && !nombreNegocio) {
      res.status(400).json({ error: 'Escribí el nombre de tu negocio.' });
      return;
    }
    const respuestas = validarRespuestas(tipo, datos.data.respuestas);
    if (!respuestas) {
      res.status(400).json({ error: 'Faltan respuestas del cuestionario.' });
      return;
    }
    const planValido = await pool.query('SELECT 1 FROM planes WHERE codigo = $1', [plan]);
    if (planValido.rowCount === 0) {
      res.status(400).json({ error: 'Elegí uno de los tres planes.' });
      return;
    }

    const claveHash = await bcrypt.hash(clave, COSTO_BCRYPT);
    const usuarioId = randomUUID();
    try {
      // Todo o nada: si algo falla no queda un usuario sin perfil o sin espacio.
      await conUsuario(usuarioId, async (c) => {
        await c.query('INSERT INTO usuarios (id, email, tipo, clave_hash) VALUES ($1, $2, $3, $4)', [usuarioId, email, tipo, claveHash]);
        await c.query('INSERT INTO perfiles (usuario_id, nombre, nombre_negocio, respuestas) VALUES ($1, $2, $3, $4)', [
          usuarioId,
          nombre,
          tipo === 'pyme' ? nombreNegocio : null,
          JSON.stringify(respuestas),
        ]);
        await c.query('INSERT INTO suscripciones (usuario_id, plan_codigo) VALUES ($1, $2)', [usuarioId, plan]);
        await c.query('INSERT INTO espacios_trabajo (usuario_id, nombre) VALUES ($1, $2)', [
          usuarioId,
          tipo === 'pyme' ? nombreNegocio : 'Mi plata',
        ]);
        await abrirSesion(c, res, usuarioId);
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        res.clearCookie('cc_sesion', { path: '/' });
        res.status(409).json({ error: 'Ya hay una cuenta con ese email. Probá ingresar.', campo: 'email' });
        return;
      }
      throw error;
    }
    res.status(201).json({ ok: true });
  });

  router.post('/auth/ingresar', limitador, porCuenta, async (req, res) => {
    const datos = z.object({ email, clave: z.string().max(200) }).safeParse(req.body);
    const usuario = datos.success
      ? (await pool.query('SELECT id, clave_hash FROM usuarios WHERE email = $1', [datos.data.email])).rows[0]
      : undefined;
    const coincide = await bcrypt.compare(datos.success ? datos.data.clave : '', usuario?.clave_hash ?? HASH_FICTICIO);
    if (!usuario || !coincide) {
      res.status(401).json({ error: 'El email o la contraseña no coinciden.' });
      return;
    }
    await abrirSesion(pool, res, usuario.id);
    res.json({ ok: true });
  });

  /**
   * El enlace del mail lleva a la misma dirección por la que se pidió (localhost o el enlace del grupo),
   * pero solo si es una dirección conocida: si no, alguien podría hacer que el mail apunte a otro sitio.
   */
  function direccionPublica(req: Request): string {
    const host = (req.get('x-forwarded-host') ?? req.get('host') ?? '').split(',')[0].trim().toLowerCase();
    const propio = new URL(config.urlApp).host;
    const conocido = host === propio || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) || /^[a-z0-9-]+\.trycloudflare\.com$/.test(host);
    if (!conocido) return config.urlApp;
    const protocolo = (req.get('x-forwarded-proto') ?? req.protocol).split(',')[0].trim();
    return `${protocolo === 'https' || host.endsWith('.trycloudflare.com') ? 'https' : 'http'}://${host}`;
  }

  // Responde lo mismo exista o no la cuenta, y el mail sale aparte: así no se puede averiguar
  // quién está registrado ni por la respuesta ni por cuánto tarda.
  router.post('/auth/recuperar', limitador, async (req, res) => {
    // A un bot se le responde igual que a una persona, pero no se manda nada.
    if (pareceBot(req.body)) {
      res.json({ ok: true });
      return;
    }
    const datos = z.object({ email }).safeParse(req.body);
    if (!datos.success) {
      res.status(400).json({ error: 'Revisá el email.' });
      return;
    }
    const usuario = (await pool.query('SELECT id FROM usuarios WHERE email = $1', [datos.data.email])).rows[0];
    if (usuario) {
      const token = randomBytes(32).toString('base64url');
      await pool.query('DELETE FROM recuperaciones WHERE usuario_id = $1', [usuario.id]);
      await pool.query('INSERT INTO recuperaciones (token_hash, usuario_id, expira_en) VALUES ($1, $2, $3)', [
        createHash('sha256').update(token).digest('hex'),
        usuario.id,
        new Date(Date.now() + DURACION_RECUPERACION_MS),
      ]);
      // El token va después del #: el navegador no lo manda al servidor ni queda en sus registros.
      const enlace = `${direccionPublica(req)}/restablecer#token=${token}`;
      void enviarCorreo({
        para: datos.data.email,
        asunto: 'Cambiá tu contraseña de AURA',
        texto: `Pediste cambiar tu contraseña de AURA. Entrá a este enlace para elegir una nueva:\n\n${enlace}\n\nEl enlace sirve una sola vez y vence en 1 hora. Si no lo pediste, ignorá este mail: tu contraseña sigue igual.`,
        html: correoDeRecupero(enlace),
      })
        .then(() => console.log('Correo de recuperación enviado.'))
        .catch((error) => console.error(`No se pudo enviar el correo de recuperación (${(error as Error).message}).`));
    }
    res.json({ ok: true });
  });

  router.post('/auth/restablecer', limitador, async (req, res) => {
    const datos = z.object({ token: z.string().min(20).max(200), clave: claveNueva }).safeParse(req.body);
    if (!datos.success) {
      res.status(400).json({ error: datos.error.issues.find((i) => i.path[0] === 'clave')?.message ?? 'El enlace no es válido. Pedí uno nuevo.' });
      return;
    }
    const claveHash = await bcrypt.hash(datos.data.clave, COSTO_BCRYPT);
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      // La condición sobre usado_en hace que el enlace sirva una sola vez, aunque llegue dos veces a la vez.
      const usado = (
        await cliente.query(
          'UPDATE recuperaciones SET usado_en = now() WHERE token_hash = $1 AND usado_en IS NULL AND expira_en > now() RETURNING usuario_id',
          [createHash('sha256').update(datos.data.token).digest('hex')],
        )
      ).rows[0];
      if (!usado) {
        await cliente.query('ROLLBACK');
        res.status(400).json({ error: 'El enlace venció o ya se usó. Pedí uno nuevo.' });
        return;
      }
      await cliente.query('UPDATE usuarios SET clave_hash = $1 WHERE id = $2', [claveHash, usado.usuario_id]);
      // Quien tenía la contraseña vieja abierta en otro lado queda afuera.
      await cliente.query('DELETE FROM sesiones WHERE usuario_id = $1', [usado.usuario_id]);
      await cliente.query('DELETE FROM recuperaciones WHERE usuario_id = $1 AND usado_en IS NULL', [usado.usuario_id]);
      await cliente.query('COMMIT');
    } catch (error) {
      await cliente.query('ROLLBACK');
      throw error;
    } finally {
      cliente.release();
    }
    res.json({ ok: true });
  });

  router.post('/auth/cambiar-clave', requerirSesion, limitador, async (req, res) => {
    const datos = z.object({ actual: z.string().max(200), nueva: claveNueva }).safeParse(req.body);
    if (!datos.success) {
      res.status(400).json({ error: datos.error.issues.find((i) => i.path[0] === 'nueva')?.message ?? 'Revisá los datos.' });
      return;
    }
    const { id } = req.usuario;
    const { clave_hash } = (await pool.query('SELECT clave_hash FROM usuarios WHERE id = $1', [id])).rows[0];
    if (!(await bcrypt.compare(datos.data.actual, clave_hash))) {
      res.status(400).json({ error: 'La contraseña actual no coincide.' });
      return;
    }
    const claveHash = await bcrypt.hash(datos.data.nueva, COSTO_BCRYPT);
    await pool.query('UPDATE usuarios SET clave_hash = $1 WHERE id = $2', [claveHash, id]);
    // Las otras sesiones abiertas (otro celular, otra compu) quedan afuera; esta sigue.
    await pool.query('DELETE FROM sesiones WHERE usuario_id = $1 AND token_hash <> $2', [id, sesionActual(req)]);
    res.json({ ok: true });
  });

  router.post('/auth/salir', async (req, res) => {
    await cerrarSesion(req, res);
    res.json({ ok: true });
  });

  router.get('/yo', requerirSesion, async (req, res) => {
    const { id, email, tipo } = req.usuario;
    const yo = await conUsuario(id, async (c) => {
      const perfil = (
        await c.query(
          `SELECT nombre, apellido, nombre_negocio, respuestas, CASE WHEN foto IS NULL THEN NULL ELSE left(md5(foto), 10) END AS foto_version
           FROM perfiles WHERE usuario_id = $1`,
          [id],
        )
      ).rows[0];
      const plan = (
        await c.query(
          `SELECT p.codigo, p.nombre, p.precio_mensual_ars, p.incluye_publicidad, p.limite_registros_mes, p.modulos, p.beneficios, s.estado
           FROM suscripciones s JOIN planes p ON p.codigo = s.plan_codigo WHERE s.usuario_id = $1`,
          [id],
        )
      ).rows[0];
      const espacios = (await c.query('SELECT id, nombre FROM espacios_trabajo WHERE usuario_id = $1 ORDER BY creado_en', [id])).rows;
      return { perfil, plan, espacios };
    });
    res.json({
      usuario: { id, email, tipo },
      perfil: {
        nombre: yo.perfil.nombre,
        apellido: yo.perfil.apellido,
        nombreNegocio: yo.perfil.nombre_negocio,
        respuestas: yo.perfil.respuestas,
        // Cambia cuando cambia la foto, así el navegador no muestra una vieja guardada.
        fotoVersion: yo.perfil.foto_version,
      },
      plan: yo.plan,
      espacios: yo.espacios,
      adaptacion: adaptarInterfaz(tipo, yo.perfil.respuestas),
    });
  });

  return router;
}
