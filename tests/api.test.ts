// Pruebas contra un servidor real y PostgreSQL real (base cajaclara_v4_test, con el rol de la app).

import { createHash, randomUUID } from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearApp } from '../server/app';
import { conUsuario, pool } from '../server/db';

let servidor: Server;
let base: string;

beforeAll(async () => {
  servidor = crearApp({ limitarIntentos: false }).listen(0, '127.0.0.1');
  await new Promise((ok) => servidor.once('listening', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  servidor.close();
  await pool.end();
});

const RESPUESTAS_PYME = {
  rubro: 'gastronomia',
  empleados: '1_3',
  condicion_fiscal: 'monotributo',
  medios_cobro: ['efectivo', 'tarjeta'],
  registro_actual: 'cuaderno',
  preocupacion: 'pagos',
  experiencia: 'nueva',
};

const RESPUESTAS_PERSONA = {
  ocupacion: 'empleo',
  ingresos: 'fijos',
  hogar: 'solo',
  cuotas: 'pocas',
  registro_actual: 'planilla',
  objetivo: 'ahorrar',
  experiencia: 'alta',
};

function emailNuevo() {
  return `prueba-${randomUUID()}@ejemplo.test`;
}

function altaPyme(extra: object = {}) {
  return { tipo: 'pyme', nombre: 'Marta', nombreNegocio: 'La Esquina', email: emailNuevo(), clave: 'clave-de-prueba-1', plan: 'gratis', respuestas: RESPUESTAS_PYME, ...extra };
}

function altaPersona(extra: object = {}) {
  return { tipo: 'persona', nombre: 'Diego', email: emailNuevo(), clave: 'clave-de-prueba-2', plan: 'full', respuestas: RESPUESTAS_PERSONA, ...extra };
}

async function pedir(ruta: string, opciones: { metodo?: string; cuerpo?: unknown; cookie?: string; origen?: string } = {}) {
  const res = await fetch(base + ruta, {
    method: opciones.metodo ?? 'GET',
    headers: {
      ...(opciones.cuerpo !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opciones.cookie ? { cookie: opciones.cookie } : {}),
      ...(opciones.origen ? { origin: opciones.origen } : {}),
    },
    body: opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined,
  });
  const texto = await res.text();
  return { status: res.status, cuerpo: texto ? JSON.parse(texto) : null, setCookie: res.headers.get('set-cookie') };
}

async function registrar(alta: object) {
  const res = await pedir('/api/auth/registro', { metodo: 'POST', cuerpo: alta });
  expect(res.status).toBe(201);
  const cookie = res.setCookie!.split(';')[0];
  const yo = (await pedir('/api/yo', { cookie })).cuerpo;
  return { cookie, yo, espacioId: yo.espacios[0].id as string };
}

const MOVIMIENTO = { tipo: 'egreso', monto: 80000, concepto: 'Harina', categoria: 'Insumos', fecha: '2026-11-01' };

describe('planes', () => {
  it('informa los tres planes con su precio, sin pedir cuenta', async () => {
    const { status, cuerpo } = await pedir('/api/planes');
    expect(status).toBe(200);
    expect(cuerpo.planes.map((p: any) => [p.codigo, p.precio_mensual_ars, p.incluye_publicidad])).toEqual([
      ['gratis', 0, true],
      ['intermedio', 9900, false],
      ['full', 25900, false],
    ]);
  });
});

describe('registro', () => {
  it('una pyme nueva queda con perfil, espacio y plan, sin datos de pago', async () => {
    const { yo } = await registrar(altaPyme({ plan: 'intermedio' }));
    expect(yo.usuario.tipo).toBe('pyme');
    expect(yo.perfil.nombreNegocio).toBe('La Esquina');
    expect(yo.perfil.respuestas.rubro).toBe('gastronomia');
    expect(yo.espacios).toHaveLength(1);
    expect(yo.espacios[0].nombre).toBe('La Esquina');
    expect(yo.plan.codigo).toBe('intermedio');
    expect(yo.plan.estado).toBe('sin_cobro');
    expect(yo.adaptacion.preguntaFoco).toBe('¿Te alcanza para pagar los sueldos?');
  });

  it('una persona nueva recibe una interfaz distinta', async () => {
    const { yo } = await registrar(altaPersona());
    expect(yo.usuario.tipo).toBe('persona');
    expect(yo.espacios[0].nombre).toBe('Mi plata');
    expect(yo.adaptacion.preguntaFoco).toBe('¿Cuánto podés guardar este mes?');
    expect(yo.adaptacion.categorias.egreso).toContain('Comida');
  });

  it('no guarda la contraseña en texto plano ni la devuelve', async () => {
    const alta = altaPersona();
    const { yo } = await registrar(alta);
    expect(JSON.stringify(yo)).not.toContain(alta.clave);
    const { rows } = await pool.query('SELECT clave_hash FROM usuarios WHERE id = $1', [yo.usuario.id]);
    expect(rows[0].clave_hash).toMatch(/^\$2[aby]\$12\$/);
  });

  it.each([
    ['tipo inválido', { tipo: 'admin' }],
    ['plan inexistente', { plan: 'gratis-total' }],
    ['clave corta', { clave: 'corta' }],
    ['email inválido', { email: 'no-es-email' }],
    ['pyme sin negocio', { nombreNegocio: undefined }],
    ['cuestionario incompleto', { respuestas: { rubro: 'gastronomia' } }],
    ['opción que no existe', { respuestas: { ...RESPUESTAS_PYME, rubro: 'casino' } }],
    ['respuestas de otro tipo de usuario', { respuestas: RESPUESTAS_PERSONA }],
    ['cobros vacíos', { respuestas: { ...RESPUESTAS_PYME, medios_cobro: [] } }],
  ])('rechaza el alta con %s y no crea nada', async (_caso, extra) => {
    const alta = altaPyme(extra);
    const { status } = await pedir('/api/auth/registro', { metodo: 'POST', cuerpo: alta });
    expect(status).toBe(400);
    const { rowCount } = await pool.query('SELECT 1 FROM usuarios WHERE email = $1', [alta.email]);
    expect(rowCount).toBe(0);
  });

  it('rechaza un email repetido, sin importar mayúsculas', async () => {
    const alta = altaPersona();
    await registrar(alta);
    const { status, cuerpo } = await pedir('/api/auth/registro', { metodo: 'POST', cuerpo: { ...alta, email: alta.email.toUpperCase() } });
    expect(status).toBe(409);
    expect(cuerpo.campo).toBe('email');
  });

  it('la base no acepta un usuario sin perfil, espacio y plan', async () => {
    const id = randomUUID();
    await expect(
      conUsuario(id, (c) => c.query(`INSERT INTO usuarios (id, email, tipo, clave_hash) VALUES ($1, $2, 'persona', 'x')`, [id, emailNuevo()])),
    ).rejects.toThrow(/alta incompleta/);
    expect((await pool.query('SELECT 1 FROM usuarios WHERE id = $1', [id])).rowCount).toBe(0);
  });
});

describe('sesión', () => {
  it('ingresa con la clave correcta y da el mismo error para clave mala y email inexistente', async () => {
    const alta = altaPersona();
    await registrar(alta);
    const ok = await pedir('/api/auth/ingresar', { metodo: 'POST', cuerpo: { email: alta.email, clave: alta.clave } });
    expect(ok.status).toBe(200);
    const mala = await pedir('/api/auth/ingresar', { metodo: 'POST', cuerpo: { email: alta.email, clave: 'otra-clave-123' } });
    const inexistente = await pedir('/api/auth/ingresar', { metodo: 'POST', cuerpo: { email: emailNuevo(), clave: 'otra-clave-123' } });
    expect(mala.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(mala.cuerpo).toEqual(inexistente.cuerpo);
  });

  it('la cookie es httpOnly y SameSite, y la base guarda solo el hash', async () => {
    const res = await pedir('/api/auth/registro', { metodo: 'POST', cuerpo: altaPersona() });
    expect(res.setCookie).toMatch(/HttpOnly/i);
    expect(res.setCookie).toMatch(/SameSite=Lax/i);
    const token = res.setCookie!.split(';')[0].split('=')[1];
    expect((await pool.query('SELECT 1 FROM sesiones WHERE token_hash = $1', [token])).rowCount).toBe(0);
  });

  it('salir invalida la sesión en el servidor', async () => {
    const { cookie } = await registrar(altaPersona());
    await pedir('/api/auth/salir', { metodo: 'POST', cookie });
    expect((await pedir('/api/yo', { cookie })).status).toBe(401);
  });

  it('una sesión vencida no sirve', async () => {
    const { yo } = await registrar(altaPersona());
    const token = randomUUID();
    await pool.query(`INSERT INTO sesiones (token_hash, usuario_id, expira_en) VALUES ($1, $2, now() - interval '1 minute')`, [
      createHash('sha256').update(token).digest('hex'),
      yo.usuario.id,
    ]);
    expect((await pedir('/api/yo', { cookie: `cc_sesion=${token}` })).status).toBe(401);
  });

  it('rechaza escrituras desde otro sitio', async () => {
    const { cookie, espacioId } = await registrar(altaPersona());
    const res = await pedir(`/api/espacios/${espacioId}/movimientos`, { metodo: 'POST', cuerpo: MOVIMIENTO, cookie, origen: 'https://sitio-malicioso.example' });
    expect(res.status).toBe(403);
  });
});

describe('aislamiento de espacios de trabajo', () => {
  it('sin sesión no se accede a nada', async () => {
    const { espacioId } = await registrar(altaPersona());
    expect((await pedir('/api/yo')).status).toBe(401);
    expect((await pedir(`/api/espacios/${espacioId}/movimientos`)).status).toBe(401);
    expect((await pedir(`/api/espacios/${espacioId}/movimientos`, { metodo: 'POST', cuerpo: MOVIMIENTO })).status).toBe(401);
  });

  it('un usuario no puede leer, escribir ni borrar en el espacio de otro', async () => {
    const ana = await registrar(altaPersona());
    const beto = await registrar(altaPyme());
    const creado = await pedir(`/api/espacios/${ana.espacioId}/movimientos`, { metodo: 'POST', cuerpo: MOVIMIENTO, cookie: ana.cookie });
    expect(creado.status).toBe(201);
    const ruta = `/api/espacios/${ana.espacioId}/movimientos`;

    const lectura = await pedir(ruta, { cookie: beto.cookie });
    expect(lectura.status).toBe(404);
    expect(JSON.stringify(lectura.cuerpo)).not.toContain('Harina');
    expect((await pedir(ruta, { metodo: 'POST', cuerpo: MOVIMIENTO, cookie: beto.cookie })).status).toBe(404);
    expect((await pedir(`${ruta}/${creado.cuerpo.id}`, { metodo: 'DELETE', cookie: beto.cookie })).status).toBe(404);
    // Tampoco por su propio espacio, apuntando al movimiento ajeno.
    expect((await pedir(`/api/espacios/${beto.espacioId}/movimientos/${creado.cuerpo.id}`, { metodo: 'DELETE', cookie: beto.cookie })).status).toBe(404);

    const deAna = await pedir(ruta, { cookie: ana.cookie });
    expect(deAna.cuerpo.movimientos).toHaveLength(1);
  });

  it('un espacio ajeno y uno inexistente responden igual', async () => {
    const ana = await registrar(altaPersona());
    const beto = await registrar(altaPyme());
    const ajeno = await pedir(`/api/espacios/${ana.espacioId}/movimientos`, { cookie: beto.cookie });
    const inexistente = await pedir(`/api/espacios/${randomUUID()}/movimientos`, { cookie: beto.cookie });
    const malformado = await pedir(`/api/espacios/1%20OR%201=1/movimientos`, { cookie: beto.cookie });
    expect(ajeno).toEqual(inexistente);
    expect(malformado.status).toBe(404);
  });

  it('cada usuario lista solo sus espacios', async () => {
    const ana = await registrar(altaPersona());
    const beto = await registrar(altaPyme());
    expect(beto.yo.espacios.map((e: any) => e.id)).not.toContain(ana.espacioId);
  });

  describe('la base lo impide aunque el código de la ruta falle', () => {
    it('RLS oculta filas ajenas, y sin usuario declarado no se ve ninguna', async () => {
      const ana = await registrar(altaPersona());
      const beto = await registrar(altaPyme());
      await pedir(`/api/espacios/${ana.espacioId}/movimientos`, { metodo: 'POST', cuerpo: MOVIMIENTO, cookie: ana.cookie });

      for (const tabla of ['espacios_trabajo', 'perfiles', 'suscripciones']) {
        const columna = tabla === 'espacios_trabajo' ? 'id' : 'usuario_id';
        const valor = tabla === 'espacios_trabajo' ? ana.espacioId : ana.yo.usuario.id;
        const visible = await conUsuario(beto.yo.usuario.id, (c) => c.query(`SELECT 1 FROM ${tabla} WHERE ${columna} = $1`, [valor]));
        expect(visible.rowCount, tabla).toBe(0);
      }
      const movs = await conUsuario(beto.yo.usuario.id, (c) => c.query('SELECT 1 FROM movimientos WHERE espacio_id = $1', [ana.espacioId]));
      expect(movs.rowCount).toBe(0);
      expect((await pool.query('SELECT 1 FROM espacios_trabajo')).rowCount).toBe(0);
      expect((await pool.query('SELECT 1 FROM movimientos')).rowCount).toBe(0);
      expect((await pool.query('SELECT 1 FROM perfiles')).rowCount).toBe(0);
    });

    it('RLS rechaza insertar en un espacio ajeno o crear un espacio para otro', async () => {
      const ana = await registrar(altaPersona());
      const beto = await registrar(altaPyme());
      await expect(
        conUsuario(beto.yo.usuario.id, (c) =>
          c.query(`INSERT INTO movimientos (espacio_id, tipo, monto_ars, concepto, categoria, fecha) VALUES ($1, 'egreso', 1, 'x', 'x', now())`, [ana.espacioId]),
        ),
      ).rejects.toThrow(/row-level security|seguridad de registros/i);
      await expect(
        conUsuario(beto.yo.usuario.id, (c) => c.query(`INSERT INTO espacios_trabajo (usuario_id, nombre) VALUES ($1, 'x')`, [ana.yo.usuario.id])),
      ).rejects.toThrow(/row-level security|seguridad de registros/i);
    });

    it('el rol de la app no puede cambiar precios, dueños ni desactivar RLS', async () => {
      const ana = await registrar(altaPersona());
      await expect(pool.query(`UPDATE planes SET precio_mensual_ars = 0`)).rejects.toThrow();
      await expect(conUsuario(ana.yo.usuario.id, (c) => c.query(`UPDATE espacios_trabajo SET usuario_id = usuario_id`))).rejects.toThrow();
      await expect(pool.query('ALTER TABLE espacios_trabajo DISABLE ROW LEVEL SECURITY')).rejects.toThrow();
      const rol = await pool.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
      expect(rol.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    });
  });
});

describe('movimientos y límites del plan', () => {
  it('calcula el saldo, ignora fechas futuras y valida los datos', async () => {
    const { cookie, espacioId } = await registrar(altaPersona());
    const ruta = `/api/espacios/${espacioId}/movimientos`;
    await pedir(ruta, { metodo: 'POST', cookie, cuerpo: { ...MOVIMIENTO, tipo: 'ingreso', monto: 100000 } });
    await pedir(ruta, { metodo: 'POST', cookie, cuerpo: MOVIMIENTO });
    await pedir(ruta, { metodo: 'POST', cookie, cuerpo: { ...MOVIMIENTO, fecha: '2099-01-01' } });
    const { cuerpo } = await pedir(ruta, { cookie });
    expect(cuerpo.resumen.saldo).toBe(20000);
    expect(cuerpo.movimientos).toHaveLength(3);
    expect(cuerpo.resumen.limiteRegistrosMes).toBeNull();
    for (const malo of [{ monto: -1 }, { monto: 1.5 }, { fecha: '2026-13-40' }, { concepto: ' ' }, { tipo: 'robo' }]) {
      expect((await pedir(ruta, { metodo: 'POST', cookie, cuerpo: { ...MOVIMIENTO, ...malo } })).status).toBe(400);
    }
  });

  it('el plan Gratis corta en 30 registros y el servidor no se deja saltear', async () => {
    const { cookie, espacioId, yo } = await registrar(altaPyme());
    expect(yo.plan.incluye_publicidad).toBe(true);
    const ruta = `/api/espacios/${espacioId}/movimientos`;
    const cargas = Array.from({ length: 35 }, () => pedir(ruta, { metodo: 'POST', cookie, cuerpo: { ...MOVIMIENTO, fecha: '2020-01-01' } }));
    const estados = (await Promise.all(cargas)).map((r) => r.status);
    expect(estados.filter((s) => s === 201)).toHaveLength(30);
    expect(estados.filter((s) => s === 403)).toHaveLength(5);
  });

  it('los planes pagos no muestran publicidad y no tienen ese límite', async () => {
    const { yo } = await registrar(altaPersona({ plan: 'intermedio' }));
    expect(yo.plan.incluye_publicidad).toBe(false);
    expect(yo.plan.limite_registros_mes).toBeNull();
  });
});
