// Convierte el perfil del usuario en la interfaz que va a ver.
// Es una función pura: la usan la vista previa del alta y la app, así nunca se contradicen.

import type { Respuestas, TipoUsuario } from './cuestionario';

export type ModuloId =
  | 'caja'
  | 'vencimientos'
  | 'alertas'
  | 'simulador'
  | 'metas'
  | 'asistente'
  | 'informes'
  | 'escenarios';

export interface Adaptacion {
  /** La pregunta que abre el Inicio. */
  preguntaFoco: string;
  etiquetaSaldo: string;
  /** Módulos ordenados por lo que más le sirve a este perfil. */
  modulos: ModuloId[];
  categorias: { ingreso: string[]; egreso: string[] };
  consejos: string[];
  /** Muestra explicaciones junto a cada dato para quien recién empieza. */
  explicaciones: boolean;
}

const ORDEN_BASE: ModuloId[] = ['caja', 'vencimientos', 'alertas', 'simulador', 'metas', 'informes', 'asistente', 'escenarios'];

const NOMBRES: Record<ModuloId, Record<TipoUsuario, string>> = {
  caja: { pyme: 'Caja del negocio a 30 días', persona: 'Tu plata a 30 días' },
  vencimientos: { pyme: 'Pagos y cobros futuros', persona: 'Pagos y cobros futuros' },
  alertas: { pyme: 'Avisos antes de que falte plata', persona: 'Avisos antes de que falte plata' },
  simulador: { pyme: 'Simulador de compras en cuotas', persona: 'Simulador de cuotas' },
  metas: { pyme: 'Reserva del negocio', persona: 'Metas de ahorro' },
  informes: { pyme: 'Informe para tu contador', persona: 'Resumen del mes' },
  asistente: { pyme: 'Asistente con IA', persona: 'Asistente con IA' },
  escenarios: { pyme: 'Escenarios de ventas bajas', persona: 'Escenarios de meses flojos' },
};

export function nombreModulo(id: ModuloId, tipo: TipoUsuario): string {
  return NOMBRES[id][tipo];
}

/** Pone primero los módulos indicados y mantiene el resto en su orden. */
function priorizar(orden: ModuloId[], primeros: ModuloId[]): ModuloId[] {
  return [...primeros, ...orden.filter((m) => !primeros.includes(m))];
}

function unica(respuestas: Respuestas, id: string): string | undefined {
  const valor = respuestas[id];
  return typeof valor === 'string' ? valor : undefined;
}

function adaptarPyme(r: Respuestas): Adaptacion {
  const conEmpleados = ['1_3', '4_10', 'mas_10'].includes(unica(r, 'empleados') ?? '');
  const rubro = unica(r, 'rubro');
  const cobros = Array.isArray(r.medios_cobro) ? r.medios_cobro : [];
  const fiscal = unica(r, 'condicion_fiscal');

  let preguntaFoco = conEmpleados ? '¿Te alcanza para pagar los sueldos?' : '¿Te alcanza para pagarles a tus proveedores?';
  let modulos = ORDEN_BASE;
  switch (unica(r, 'preocupacion')) {
    case 'vencimientos':
      preguntaFoco = '¿Qué te vence en los próximos días?';
      modulos = priorizar(modulos, ['vencimientos', 'alertas']);
      break;
    case 'cuotas':
      preguntaFoco = '¿Te conviene comprar en cuotas?';
      modulos = priorizar(modulos, ['simulador', 'caja']);
      break;
    case 'ganancia':
      preguntaFoco = '¿Cuánto te queda de verdad?';
      modulos = priorizar(modulos, ['informes', 'caja']);
      break;
  }

  const insumos = rubro === 'oficios' ? 'Materiales' : rubro === 'comercio' ? 'Mercadería' : 'Insumos';
  const egreso = [insumos, ...(conEmpleados ? ['Sueldos'] : []), 'Alquiler', 'Servicios', 'Impuestos', ...(rubro === 'oficios' ? ['Movilidad'] : []), 'Otros gastos'];

  const ingresoPorCobro: Record<string, string> = {
    efectivo: 'Cobros en efectivo',
    qr_transferencia: 'Cobros por QR o transferencia',
    tarjeta: 'Cobros con tarjeta',
    cuenta_corriente: 'Cobros de cuenta corriente',
  };
  const ingreso = [...cobros.map((c) => ingresoPorCobro[c]).filter(Boolean), 'Otros ingresos'];

  const consejos: string[] = [];
  if (cobros.includes('tarjeta')) consejos.push('Registrá las ventas con tarjeta con la fecha en que se acreditan, no con la del día que vendiste.');
  if (cobros.includes('cuenta_corriente')) consejos.push('Lo que te deben todavía no es plata en caja: registralo recién cuando lo cobres.');
  if (fiscal === 'monotributo') consejos.push('Registrá el monotributo como un gasto fijo de cada mes en Impuestos.');
  if (fiscal === 'responsable_inscripto') consejos.push('Separá el IVA y Ganancias en Impuestos para que tu contador los encuentre rápido.');
  if (fiscal === 'sin_inscribir') consejos.push('Empezá por registrar ventas y gastos: esos números te van a servir para decidir cómo inscribirte.');

  return {
    preguntaFoco,
    etiquetaSaldo: 'Hoy hay en la caja del negocio',
    modulos,
    categorias: { ingreso, egreso },
    consejos,
    explicaciones: mostrarExplicaciones(r),
  };
}

function adaptarPersona(r: Respuestas): Adaptacion {
  const ocupacion = unica(r, 'ocupacion');
  const cuotas = unica(r, 'cuotas');

  let preguntaFoco = '¿Llegás a fin de mes?';
  let modulos = ORDEN_BASE;
  switch (unica(r, 'objetivo')) {
    case 'ahorrar':
      preguntaFoco = '¿Cuánto podés guardar este mes?';
      modulos = priorizar(modulos, ['metas', 'caja']);
      break;
    case 'deudas':
      preguntaFoco = '¿Cuánta de tu plata se va en cuotas?';
      modulos = priorizar(modulos, ['vencimientos', 'simulador']);
      break;
    case 'compra':
      preguntaFoco = '¿Te alcanza para esa compra?';
      modulos = priorizar(modulos, ['simulador', 'metas']);
      break;
  }
  if (unica(r, 'ingresos') === 'variables') {
    modulos = [...modulos.filter((m) => m !== 'escenarios').slice(0, 2), 'escenarios', ...modulos.filter((m) => m !== 'escenarios').slice(2)];
  }

  const ingresoPrincipal: Record<string, string> = {
    empleo: 'Sueldo',
    independiente: 'Trabajos cobrados',
    estudiante: 'Beca o ayuda',
    jubilacion: 'Jubilación o pensión',
  };
  const ingreso = [...(ocupacion && ingresoPrincipal[ocupacion] ? [ingresoPrincipal[ocupacion]] : []), 'Otros ingresos'];

  const egreso = [
    'Comida',
    'Vivienda',
    'Servicios',
    'Transporte',
    ...(cuotas && cuotas !== 'ninguna' ? ['Cuotas'] : []),
    ...(unica(r, 'hogar') === 'familia' ? ['Familia'] : []),
    ...(ocupacion === 'estudiante' ? ['Estudios'] : []),
    'Otros gastos',
  ];

  const consejos: string[] = [];
  if (cuotas === 'muchas') consejos.push('Empezá por registrar cada cuota: sumadas te muestran cuánto ya está comprometido antes de cobrar.');
  if (unica(r, 'ingresos') === 'variables') consejos.push('Con ingresos que cambian, usá tu peor mes reciente como referencia para planificar.');
  if (unica(r, 'hogar') === 'pareja') consejos.push('Registrá solo tu parte de los gastos compartidos para ver tu plata real.');

  return {
    preguntaFoco,
    etiquetaSaldo: 'Hoy tenés',
    modulos,
    categorias: { ingreso, egreso },
    consejos,
    explicaciones: mostrarExplicaciones(r),
  };
}

function mostrarExplicaciones(r: Respuestas): boolean {
  const experiencia = unica(r, 'experiencia');
  if (experiencia) return experiencia === 'nueva';
  return unica(r, 'registro_actual') === 'de_memoria';
}

export function adaptarInterfaz(tipo: TipoUsuario, respuestas: Respuestas): Adaptacion {
  return tipo === 'pyme' ? adaptarPyme(respuestas) : adaptarPersona(respuestas);
}
