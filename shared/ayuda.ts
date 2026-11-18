// Guía de ayuda: lo que el chatbot sabe de la app. Es la base que recibe Gemini y también el
// respaldo cuando Gemini no está: busca el tema por palabras clave y responde con textos escritos
// a mano, así nunca inventa una función ni una cifra. No conoce los datos financieros del usuario.

import type { TipoUsuario } from './cuestionario';

export interface ContextoAyuda {
  tipo: TipoUsuario;
  plan: string;
  modulos: string[];
  /** Nombre del primer plan que incluye cada módulo. */
  planDe: (modulo: string) => string;
}

export interface Accion {
  texto: string;
  ruta: string;
}

export interface RespuestaAyuda {
  tema: string;
  texto: string;
  accion?: Accion;
  /** Preguntas para seguir cuando no se entendió: ninguna conversación termina en un "no sé". */
  sugerencias?: string[];
}

interface Tema {
  id: string;
  /** Inicios de palabra o frases. Las frases valen más que una palabra suelta. */
  claves: string[];
  /** Palabras que aparecen en muchos temas: orientan, pero no definen la respuesta. */
  debiles?: string[];
  texto: string | ((ctx: ContextoAyuda) => string);
  accion?: Accion;
  modulo?: string;
}

export const SUGERENCIAS_INICIALES = ['¿Cómo importo un Excel?', '¿Qué es la salud financiera?', '¿Dónde veo el dólar?', '¿Qué incluye mi plan?'];

const TEMAS: Tema[] = [
  // Primero, para que "cargar por audio" no se confunda con la carga a mano.
  {
    id: 'voz',
    claves: ['voz', 'audio', 'foto', 'ticket', 'dictar', 'microfono', 'camara'],
    texto: 'El registro por voz y por foto del ticket todavía no está disponible. Por ahora podés cargar a mano o importar un Excel.',
    accion: { texto: 'Ir a Movimientos', ruta: '/movimientos' },
  },
  {
    id: 'importar',
    claves: ['excel', 'importar', 'importo', 'importacion', 'planilla', 'xlsx', 'csv', 'subir archivo', 'cargar archivo', 'trasladar', 'pasar mis datos', 'archivo', 'hoja de calculo', 'traer', 'migrar', 'cuaderno'],
    texto:
      'Al registrar un gasto, en Movimientos o con el botón +, tocá "Importar gastos desde Excel" y elegí tu archivo .xlsx o .csv. Reconocemos las columnas solas y podés corregirlas antes de confirmar. Si volvés a importar la misma planilla no se duplica nada, y podés deshacer la importación. Si tenés un .xls viejo, guardalo antes como .xlsx.',
    accion: { texto: 'Ir a Movimientos', ruta: '/movimientos' },
  },
  {
    id: 'registrar',
    claves: ['registrar', 'registro', 'anotar', 'cargar gasto', 'cargar un gasto', 'cargar ingreso', 'agregar gasto', 'agregar movimiento', 'nuevo movimiento', 'nuevo gasto', 'cargar', 'cargo', 'cargue', 'anoto', 'anote', 'vendi', 'venta', 'ventas', 'cobre', 'gaste', 'compre', 'pongo'],
    debiles: ['movimiento', 'movimientos', 'ingreso', 'ingresos', 'gasto', 'gastos'],
    texto: 'En Movimientos o con el botón + elegí si es un gasto o un ingreso, escribí el monto y el concepto, elegí la categoría y la fecha. Si ponés una fecha futura queda programado: aparece en los pagos de la semana y en Pagos y cobros futuros, y ese día se descuenta solo de tu saldo.',
    accion: { texto: 'Ir a Movimientos', ruta: '/movimientos' },
  },
  {
    id: 'borrar',
    claves: ['borrar', 'borro', 'eliminar', 'equivoque', 'corregir', 'corrijo', 'editar', 'modificar', 'deshacer', 'arreglo', 'arreglar', 'sacar un', 'sacar el', 'quitar', 'anote mal', 'cargue mal', 'error en un movimiento'],
    texto: 'En Movimientos tocá el tacho al lado del movimiento y confirmá. Para corregirlo, borralo y cargalo de nuevo: todavía no se puede editar. Lo borrado no se pierde: queda en "Eliminados" al final de la lista y se puede restaurar.',
    accion: { texto: 'Ir a Movimientos', ruta: '/movimientos' },
  },
  {
    id: 'saldo',
    claves: ['saldo', 'cuanta plata', 'cuanto tengo', 'cuanto me queda', 'disponible', 'no coincide', 'mal el saldo'],
    texto: 'Tu saldo es la suma de lo que entró menos lo que salió, con los movimientos hasta hoy. Lo ves en el Inicio y en Caja. Si no coincide con tu cuenta, probablemente falte registrar la plata que ya tenías: cargala como un ingreso.',
    accion: { texto: 'Ir al Inicio', ruta: '/' },
  },
  {
    id: 'salud',
    claves: ['salud', 'puntaje', 'indicador', 'medidor', 'de 100', 'como calculan', 'como se calcula'],
    texto:
      'Es un puntaje de 0 a 100 calculado con tus movimientos. Mide lo que te queda de lo que entra, cuántos días de gastos cubre tu saldo, qué tan seguido estuviste arriba de tu reserva y, si hay datos, tu caja de los próximos 30 días. De 70 para arriba es buena, de 40 a 69 necesita atención y menos de 40 está en riesgo. Necesita 30 días de historia y 5 movimientos. Es una orientación, no una calificación crediticia.',
    accion: { texto: 'Ver mi salud financiera', ruta: '/' },
  },
  {
    id: 'historial',
    claves: ['historial', 'historico', 'historicos', 'meses anteriores', 'mes pasado', 'resumen del mes'],
    texto: 'El historial se arma solo con tus movimientos, también con los importados. En Caja ves cada mes con lo que entró, lo que salió, el saldo al cierre y la salud que tenía. No tenés que hacer nada extra.',
    accion: { texto: 'Ver el historial', ruta: '/caja' },
  },
  {
    id: 'semaforo',
    claves: ['semaforo', 'verde', 'amarillo', 'rojo', 'gris', 'color', 'colores'],
    texto: 'Verde: tu caja se mantiene arriba de tu reserva. Amarillo: algún día baja de la reserva. Rojo: algún día te quedarías sin plata. Gris: todavía faltan datos, necesitamos al menos 5 movimientos.',
    accion: { texto: 'Ver mi caja', ruta: '/caja' },
  },
  {
    id: 'caja',
    claves: ['caja', 'proyeccion', 'proyectada', '30 dias', 'peor dia', 'me alcanza', 'te alcanza', 'alcanza', 'grafico', 'fin de mes', 'llegar', 'llego', 'proyectar'],
    texto: 'Caja estima tu plata día por día durante los próximos 30 días y te marca tu peor día. Con eso contesta si te alcanza. Se arma sola con tus movimientos: es una estimación, no una garantía.',
    accion: { texto: 'Ir a Caja', ruta: '/caja' },
  },
  {
    id: 'parametros',
    claves: ['reserva', 'margen', 'cuota segura', 'datos de mi caja', 'datos de caja', 'parametros', 'cuatro datos', 'venta diaria', 'ventas por dia', 'queda por mes', 'que pongo'],
    texto: 'En Caja, lo que entra y lo que gastás se calculan solos con tus movimientos de los últimos 90 días y no se editan. Lo único que cargás vos es la reserva: la plata que no querés tocar. La cuota segura es el 30% de lo que te queda por mes según esos movimientos.',
    accion: { texto: 'Ir a Caja', ruta: '/caja' },
  },
  {
    id: 'escenarios',
    claves: ['escenario', 'escenarios', 'conservador', 'estres', 'mes flojo', 'ventas bajas', 'vendo menos', 'si vendo', 'peor caso', 'que pasa si'],
    modulo: 'escenarios',
    texto: 'Los escenarios muestran tu caja si las cosas salen peor: Conservador baja las ventas 15% y atrasa cobros 5 días, y Estrés las baja 30% y atrasa 10 días. Se eligen arriba del gráfico en Caja.',
    accion: { texto: 'Ir a Caja', ruta: '/caja' },
  },
  {
    id: 'alertas',
    claves: ['aviso', 'avisos', 'alerta', 'alertas', 'notificacion', 'recordatorio', 'whatsapp', 'mail', 'correo'],
    modulo: 'alertas',
    texto: 'Los avisos aparecen en Caja: pagos vencidos, próximos vencimientos, cobros atrasados y días en que te quedarías corto. Por ahora se ven solo dentro de la app: todavía no enviamos correos ni mensajes de WhatsApp.',
    accion: { texto: 'Ir a Caja', ruta: '/caja' },
  },
  {
    id: 'vencimientos',
    claves: ['vencimiento', 'vencimientos', 'vence', 'agendar', 'agenda', 'calendario', 'pago futuro', 'proximo pago', 'cuentas por pagar', 'cobro', 'pagar alquiler', 'pagado', 'reprogramar', 'mensual', 'todos los meses', 'posponer', 'futuro', 'futuros', 'a futuro', 'programado', 'programados', 'cargas a futuro', 'pagos futuros', 'cobros futuros', 'pagos y cobros', 'pague', 'alquiler', 'factura', 'marco', 'tengo que pagar', 'atrasar', 'pasar para'],
    modulo: 'vencimientos',
    texto: 'En Pagos y cobros futuros agendás los pagos y cobros que van a venir, y si se repiten cada mes. Al marcar uno como pagado se registra el movimiento solo y, si es mensual, se agenda el próximo. Con "7 días más" lo pasás para adelante y mirás cómo cambia tu caja. Abajo de todo está el Historial: ahí ves lo pagado, lo cobrado y lo eliminado; con "Deshacer pago" algo marcado por error vuelve a pendiente, y con "Volver a agendar" recuperás lo que eliminaste.',
    accion: { texto: 'Ir a Pagos y cobros futuros', ruta: '/vencimientos' },
  },
  {
    id: 'simulador',
    claves: ['simulador', 'simular', 'simulacion', 'cuota', 'cuotas', 'comprar', 'compra en', 'financiar', 'horno', 'anticipo', 'amortizacion'],
    modulo: 'simulador',
    texto: 'En Simulador escribí qué querés comprar, el precio, el anticipo, las cuotas y la tasa. Te muestra la cuota, el costo total y si tu caja lo aguanta, sin guardar nada hasta que lo decidas. Si da rojo, te pide confirmar dos veces antes de guardarlo.',
    accion: { texto: 'Ir al Simulador', ruta: '/simulador' },
  },
  {
    id: 'dolar',
    claves: ['dolar', 'dolares', 'cotizacion', 'blue', 'mep', 'ccl', 'contado con liquidacion', 'tipo de cambio'],
    texto: 'En Mercado ves el dólar oficial, blue, bolsa, contado con liquidación y otros, con compra, venta y hora de actualización. Los datos salen de una fuente pública.',
    accion: { texto: 'Ir a Mercado', ruta: '/mercado' },
  },
  {
    id: 'creditos',
    claves: ['credito', 'creditos', 'prestamo', 'prestamos', 'oferta crediticia', 'ofertas crediticias', 'financiamiento', 'hipotecario', 'prendario', 'tasa', 'tasas', 'cft', 'tea', 'banco', 'bancos', 'prestada', 'prestan', 'plata prestada', 'endeudar'],
    texto: 'En Mercado, en Créditos, ves préstamos personales, prendarios e hipotecarios tal como las entidades se los informan al BCRA, con su costo financiero total. El BCRA no publica líneas específicas para PyMEs. Confirmá siempre las condiciones con la entidad.',
    accion: { texto: 'Ver créditos', ruta: '/mercado' },
  },
  {
    id: 'inversiones',
    claves: ['inversion', 'inversiones', 'invertir', 'plazo fijo', 'plazos fijos', 'fondo', 'fondos', 'fci', 'letras', 'lecap', 'rendimiento', 'ahorrar', 'ahorro', 'ahorros', 'rinde', 'rendir'],
    texto: 'En Mercado, en Inversiones, ves tasas de plazo fijo por banco, letras del Tesoro y fondos comunes con su rendimiento reciente. Es información pública para comparar: lo que rindió antes no garantiza lo que va a rendir.',
    accion: { texto: 'Ver inversiones', ruta: '/mercado' },
  },
  {
    id: 'planes',
    claves: ['plan', 'planes', 'suscripcion', 'precio', 'precios', 'cuanto cuesta', 'cuanto sale', 'gratis', 'intermedio', 'full', 'incluye', 'bloqueado', 'candado'],
    texto: (ctx) =>
      `Tenés el plan ${ctx.plan}. Gratis cuesta $0, incluye publicidad, 30 registros por mes, movimientos y caja. Intermedio cuesta $9.900 por mes y suma vencimientos, avisos, simulador y registros sin límite, sin publicidad. Full cuesta $25.900 por mes y suma informes y escenarios. El candado marca lo que tu plan no incluye. Tu plan se cambia en Configuración.`,
    accion: { texto: 'Ir a Configuración', ruta: '/configuracion' },
  },
  {
    id: 'cambiar_plan',
    claves: ['cambio de plan', 'cambio el plan', 'cambiar de plan', 'cambiar el plan', 'cambiar mi plan', 'mejorar plan', 'subir de plan', 'pasarme', 'cobran', 'cobrar', 'tarjeta', 'cobro de la suscripcion', 'dar de baja', 'cancelar', 'darme de baja'],
    texto: 'Podés subir o bajar de plan cuando quieras desde Configuración, en "Tu suscripción". Por ahora no se cobra nada y no pedimos datos de pago. Si bajás, tus datos no se borran: vuelven a aparecer si subís de nuevo.',
    accion: { texto: 'Cambiar de plan', ruta: '/configuracion' },
  },
  {
    id: 'publicidad',
    claves: ['publicidad', 'anuncio', 'anuncios', 'propaganda'],
    texto: 'La publicidad aparece solo en el plan Gratis. Los planes Intermedio y Full no tienen.',
  },
  {
    id: 'perfil',
    claves: ['perfil', 'configuracion', 'ajustes', 'mis datos', 'cuestionario', 'respuestas', 'mis respuestas', 'cambiar mi nombre', 'apellido', 'foto', 'mi foto', 'camara', 'sacarme una foto', 'selfie', 'imagen', 'modo oscuro', 'oscuro', 'modo claro', 'apariencia', 'nombre del negocio'],
    texto: 'En Configuración editás tu nombre, tu apellido, tu foto (la subís o te la sacás con la cámara) y, si sos PyME, el nombre del negocio. También elegís el modo claro, oscuro o automático, cambiás tu contraseña y ves tu plan y lo que respondiste al registrarte.',
    accion: { texto: 'Ir a Configuración', ruta: '/configuracion' },
  },
  {
    id: 'clave',
    claves: ['contrasena', 'clave', 'olvide', 'recuperar', 'no puedo entrar', 'password'],
    texto: 'Si sabés tu contraseña, la cambiás en Configuración. Si la olvidaste, en la pantalla de ingreso tocá "¿Olvidaste tu contraseña?", escribí tu email y te mandamos un enlace para elegir una nueva. Vence en 1 hora y sirve una sola vez. En cada campo de contraseña, el ojito te deja verla mientras la escribís.',
    accion: { texto: 'Ir a Configuración', ruta: '/configuracion' },
  },
  {
    id: 'salir',
    claves: ['salir', 'salgo', 'sesion', 'cierro', 'cerrar sesion', 'desconectar', 'logout'],
    texto: 'Para salir, tocá "Cerrar sesión" en el menú, o entrá a Configuración y tocá "Salir de la cuenta" al final de la pantalla.',
    accion: { texto: 'Ir a Configuración', ruta: '/configuracion' },
  },
  {
    id: 'seguridad',
    claves: ['seguro', 'seguridad', 'privacidad', 'quien ve', 'quien puede ver', 'ver mis datos', 'otros usuarios', 'otro usuario', 'mi espacio', 'hackear', 'confidencial', 'mis datos estan', 'compartir'],
    texto: 'Tu espacio de trabajo es solo tuyo: ningún otro usuario puede ver ni cambiar tus datos, y eso lo controla también la base de datos. No pedimos claves bancarias ni datos de pago.',
  },
  {
    id: 'eliminados',
    claves: ['borre', 'borrado', 'borrados', 'recuperar', 'restaurar', 'eliminado', 'eliminados', 'sin querer', 'por error', 'desmarcar', 'marque pagado', 'no lo pague', 'volver atras'],
    texto: 'Nada de lo que borrás se pierde. Un movimiento borrado queda en Movimientos, en "Eliminados" al final de la lista, y con "Restaurar" vuelve a contar en tu saldo. Si borrás el movimiento de un pago agendado, ese pago vuelve solo a Pagos y cobros futuros como pendiente. Y si marcaste como pagado algo que no pagaste, en el Historial de Pagos y cobros futuros tocás "Deshacer pago".',
    accion: { texto: 'Ir a Movimientos', ruta: '/movimientos' },
  },
  {
    id: 'informes',
    claves: ['informe', 'informes', 'reporte', 'reportes', 'contador', 'pdf', 'exportar', 'descargar', 'imprimir', 'resumen del mes'],
    modulo: 'informes',
    texto: 'En Informes elegís el período y qué incluir: los movimientos con totales por categoría, tu plata a 30 días y los pagos y cobros futuros. Lo descargás en PDF (se abre la ventana de impresión y elegís "Guardar como PDF") o en Excel para tu contador. Está en el plan Full.',
    accion: { texto: 'Ir a Informes', ruta: '/informes' },
  },
  {
    id: 'proximo',
    claves: ['metas', 'asistente'],
    texto: 'Las metas de ahorro y el asistente con IA todavía no están disponibles. Figuran en el Inicio como "próximamente".',
  },
  {
    id: 'que_es',
    claves: ['que es aura', 'que es caja clara', 'para que sirve', 'que hace', 'como funciona', 'como empiezo', 'como arranco', 'por donde empiezo', 'primeros pasos', 'ayuda', 'no entiendo', 'perdido', 'arranco', 'aplicacion', 'para que es'],
    texto: 'AURA te ayuda a saber hoy si te alcanza mañana. Para arrancar: registrá tus movimientos o importá tu Excel, cargá los datos de tu caja y mirá tu salud financiera en el Inicio.',
    accion: { texto: 'Ir a Movimientos', ruta: '/movimientos' },
  },
];

const CONSEJO = /(en que|donde|cual|que)\s+(me conviene|conviene|deberia|debo|tengo que|invierto|invertir|es mejor|es el mejor|es la mejor)|me conviene|deberia (invertir|comprar|pedir|tomar|sacar)|mejor (banco|credito|inversion|prestamo|plazo)|recomenda|aconseja/;
const SALUDO = /^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|que tal)\b[\s!.,]*$/;
const GRACIAS = /^(gracias|muchas gracias|genial|perfecto|listo|dale|ok|okay|buenisimo)\b[\s!.,]*$/;

export const RUTAS_AYUDA = ['/', '/movimientos', '/caja', '/vencimientos', '/simulador', '/mercado', '/informes', '/configuracion'];

/** Secciones que dependen del plan. */
export const ModuloDeRuta: Record<string, string | undefined> = { '/vencimientos': 'vencimientos', '/simulador': 'simulador', '/informes': 'informes' };

/** La guía completa como texto, adaptada al plan de esta persona. */
export function baseDeConocimiento(ctx: ContextoAyuda): string {
  return TEMAS.map((t) => {
    const texto = typeof t.texto === 'function' ? t.texto(ctx) : t.texto;
    const bloqueo = t.modulo && !ctx.modulos.includes(t.modulo) ? ` Su plan no lo incluye: está disponible desde el plan ${ctx.planDe(t.modulo)}.` : '';
    const seccion = t.accion && !bloqueo ? ` Sección: ${t.accion.ruta}.` : '';
    return `- ${texto}${bloqueo}${seccion}`;
  }).join('\n');
}

export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function puntuar(tema: Tema, consulta: string): number {
  const palabras = consulta.split(' ');
  let puntos = 0;
  for (const clave of tema.claves) {
    const normal = normalizarTexto(clave);
    if (normal.includes(' ')) {
      if (consulta.includes(normal)) puntos += 3;
    } else if (palabras.some((p) => p === normal || (normal.length >= 5 && p.startsWith(normal)))) {
      puntos += 2;
    }
  }
  for (const debil of tema.debiles ?? []) {
    if (palabras.includes(debil)) puntos += 1;
  }
  return puntos;
}

/** Lo que se contesta sin buscar ni consultar a nadie: saludos y pedidos de consejo. */
export function respuestaPrevia(pregunta: string): RespuestaAyuda | null {
  const consulta = normalizarTexto(pregunta);
  if (SALUDO.test(consulta)) return { tema: 'saludo', texto: 'Hola. Preguntame cómo usar AURA o adónde querés ir.' };
  if (GRACIAS.test(consulta)) return { tema: 'gracias', texto: 'De nada. Si necesitás algo más, preguntame.' };
  if (CONSEJO.test(consulta)) {
    return {
      tema: 'consejo',
      texto: 'No puedo recomendarte qué hacer con tu plata: solo te explico cómo usar la app. En Mercado podés comparar opciones con datos públicos, y en Caja y el Simulador ver cómo afectan a tus números. Para una decisión importante, consultá con un profesional.',
      accion: { texto: 'Ir a Mercado', ruta: '/mercado' },
    };
  }
  return null;
}

export function responder(pregunta: string, ctx: ContextoAyuda): RespuestaAyuda {
  const previa = respuestaPrevia(pregunta);
  if (previa) return previa;
  const consulta = normalizarTexto(pregunta);

  let mejor: Tema | null = null;
  let mejorPuntaje = 0;
  for (const tema of TEMAS) {
    const puntos = puntuar(tema, consulta);
    if (puntos > mejorPuntaje) {
      mejor = tema;
      mejorPuntaje = puntos;
    }
  }

  if (!mejor) {
    return {
      tema: 'sin_respuesta',
      texto: 'No entendí esa pregunta. Solo sé sobre el uso de AURA. Probá con otras palabras o elegí uno de estos temas:',
      sugerencias: ['¿Cómo cargo un movimiento?', '¿Cómo importo un Excel?', '¿Qué muestra la caja?', '¿Cómo agendo un vencimiento?', '¿Cómo uso el simulador?', '¿Dónde veo el dólar?', '¿Qué incluye mi plan?'],
    };
  }

  const texto = typeof mejor.texto === 'function' ? mejor.texto(ctx) : mejor.texto;
  if (mejor.modulo && !ctx.modulos.includes(mejor.modulo)) {
    return { tema: mejor.id, texto: `${texto} Tu plan ${ctx.plan} no lo incluye: está disponible desde el plan ${ctx.planDe(mejor.modulo)}.` };
  }
  return { tema: mejor.id, texto, accion: mejor.accion };
}
