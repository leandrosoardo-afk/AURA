import { describe, expect, it } from 'vitest';
import { responder, type ContextoAyuda } from '../shared/ayuda';

const FULL: ContextoAyuda = {
  tipo: 'pyme',
  plan: 'Full',
  modulos: ['movimientos', 'caja', 'vencimientos', 'alertas', 'simulador', 'metas', 'asistente', 'informes', 'escenarios'],
  planDe: (m) => (m === 'escenarios' ? 'Full' : 'Intermedio'),
};
const GRATIS: ContextoAyuda = { ...FULL, plan: 'Gratis', modulos: ['movimientos', 'caja'] };

describe('entiende las preguntas frecuentes', () => {
  it.each([
    ['¿Cómo importo un Excel?', 'importar'],
    ['quiero subir mi planilla de caja', 'importar'],
    ['tengo un archivo csv del banco', 'importar'],
    ['¿Cómo cargo un gasto?', 'registrar'],
    ['como registro un ingreso', 'registrar'],
    ['me equivoqué en un movimiento', 'borrar'],
    ['por qué mi saldo no coincide', 'saldo'],
    ['¿Qué es la salud financiera?', 'salud'],
    ['cómo se calcula el puntaje', 'salud'],
    ['dónde veo los meses anteriores', 'historial'],
    ['qué significa el amarillo', 'semaforo'],
    ['¿me alcanza para fin de mes?', 'caja'],
    ['qué es la reserva', 'parametros'],
    ['qué es el escenario de estrés', 'escenarios'],
    ['me avisan por whatsapp?', 'alertas'],
    ['cómo agendo un vencimiento', 'vencimientos'],
    ['quiero simular una compra en cuotas', 'simulador'],
    ['¿Dónde veo el dólar?', 'dolar'],
    ['a cuánto está el blue', 'dolar'],
    ['ofertas de préstamos', 'creditos'],
    ['tasas de plazo fijo', 'inversiones'],
    ['opciones de inversión', 'inversiones'],
    ['¿Qué incluye mi plan?', 'planes'],
    ['cuánto cuesta el plan full', 'planes'],
    ['cómo cambio de plan', 'cambiar_plan'],
    ['me van a cobrar con tarjeta?', 'cambiar_plan'],
    ['cómo saco la publicidad', 'publicidad'],
    ['olvidé mi contraseña', 'clave'],
    ['cómo cierro sesión', 'salir'],
    ['quién puede ver mis datos', 'seguridad'],
    ['puedo cargar por audio', 'voz'],
    ['quiero un informe para mi contador', 'informes'],
    ['por dónde empiezo', 'que_es'],
  ])('"%s" lleva a %s', (pregunta, tema) => {
    expect(responder(pregunta, FULL).tema).toBe(tema);
  });
});

describe('sus límites', () => {
  it.each(['¿en qué me conviene invertir?', 'qué banco me recomendás', 'debería sacar un crédito?', 'cuál es el mejor plazo fijo'])('no da consejos financieros: "%s"', (pregunta) => {
    const r = responder(pregunta, FULL);
    expect(r.tema).toBe('consejo');
    expect(r.texto).toContain('No puedo recomendarte');
  });

  it.each(['cuál es la capital de Francia', 'asdfgh', '', '???'])('reconoce lo que no sabe: "%s"', (pregunta) => {
    const r = responder(pregunta, FULL);
    expect(r.tema).toBe('sin_respuesta');
    expect(r.accion).toBeUndefined();
    expect(r.sugerencias?.length).toBeGreaterThan(0);
  });

  it('las sugerencias que ofrece se entienden', () => {
    for (const s of responder('asdfgh', FULL).sugerencias!) expect(responder(s, FULL).tema, s).not.toBe('sin_respuesta');
  });

  it('no afirma funciones que no existen', () => {
    expect(responder('me avisan por whatsapp?', FULL).texto).toContain('todavía no enviamos');
    expect(responder('puedo cargar por audio', FULL).texto).toContain('todavía no está disponible');
    expect(responder('olvidé mi contraseña', FULL).texto).toContain('¿Olvidaste tu contraseña?');
  });

  it('responde saludos y agradecimientos', () => {
    expect(responder('Hola!', FULL).tema).toBe('saludo');
    expect(responder('muchas gracias', FULL).tema).toBe('gracias');
  });
});

describe('tiene en cuenta el plan', () => {
  it('con el módulo incluido ofrece ir', () => {
    expect(responder('quiero simular una compra', FULL).accion?.ruta).toBe('/simulador');
  });

  it('sin el módulo avisa qué plan lo incluye y no ofrece un botón', () => {
    const r = responder('quiero simular una compra', GRATIS);
    expect(r.texto).toContain('Tu plan Gratis no lo incluye');
    expect(r.texto).toContain('plan Intermedio');
    expect(r.accion).toBeUndefined();
  });

  it('nombra el plan actual', () => {
    expect(responder('qué incluye mi plan', GRATIS).texto).toContain('Tenés el plan Gratis');
  });

  it('todo botón apunta a una sección que existe', () => {
    const rutas = new Set(['/', '/movimientos', '/caja', '/vencimientos', '/simulador', '/mercado', '/informes', '/configuracion']);
    for (const p of ['excel', 'saldo', 'salud', 'caja', 'dolar', 'prestamo', 'inversion', 'plan', 'perfil', 'salir', 'simular', 'vencimiento', 'escenario', 'historial']) {
      const ruta = responder(p, FULL).accion?.ruta;
      expect(ruta && rutas.has(ruta), p).toBe(true);
    }
  });
});
