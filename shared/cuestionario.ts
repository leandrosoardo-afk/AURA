// Cuestionario inicial. Lo usan el alta (para mostrarlo) y el servidor (para validarlo).

export type TipoUsuario = 'pyme' | 'persona';
export type Respuestas = Record<string, string | string[]>;

export interface Opcion {
  valor: string;
  texto: string;
}

export interface Pregunta {
  id: string;
  titulo: string;
  ayuda?: string;
  multiple?: boolean;
  opciones: Opcion[];
}

const REGISTRO_ACTUAL: Opcion[] = [
  { valor: 'de_memoria', texto: 'No lo anoto, lo llevo de memoria' },
  { valor: 'cuaderno', texto: 'En un cuaderno o en el celular' },
  { valor: 'planilla', texto: 'En una planilla de Excel' },
  { valor: 'sistema', texto: 'En una app o un sistema' },
];

const EXPERIENCIA: Opcion[] = [
  { valor: 'nueva', texto: 'Me cuesta, explicámelo fácil' },
  { valor: 'media', texto: 'Me manejo con lo básico' },
  { valor: 'alta', texto: 'Me siento cómodo con los números' },
];

export const PREGUNTAS: Record<TipoUsuario, Pregunta[]> = {
  pyme: [
    {
      id: 'rubro',
      titulo: '¿A qué se dedica tu negocio?',
      opciones: [
        { valor: 'gastronomia', texto: 'Gastronomía y alimentos' },
        { valor: 'comercio', texto: 'Comercio' },
        { valor: 'oficios', texto: 'Oficios y servicios' },
        { valor: 'produccion', texto: 'Producción o taller' },
        { valor: 'otro', texto: 'Otro rubro' },
      ],
    },
    {
      id: 'empleados',
      titulo: '¿Cuántas personas trabajan con vos?',
      opciones: [
        { valor: 'solo', texto: 'Trabajo solo' },
        { valor: '1_3', texto: 'De 1 a 3' },
        { valor: '4_10', texto: 'De 4 a 10' },
        { valor: 'mas_10', texto: 'Más de 10' },
      ],
    },
    {
      id: 'condicion_fiscal',
      titulo: '¿Cómo estás inscripto?',
      opciones: [
        { valor: 'monotributo', texto: 'Monotributo' },
        { valor: 'responsable_inscripto', texto: 'Responsable inscripto' },
        { valor: 'sin_inscribir', texto: 'Todavía no me inscribí' },
      ],
    },
    {
      id: 'medios_cobro',
      titulo: '¿Cómo te pagan tus clientes?',
      ayuda: 'Podés elegir más de una opción.',
      multiple: true,
      opciones: [
        { valor: 'efectivo', texto: 'Efectivo' },
        { valor: 'qr_transferencia', texto: 'QR o transferencia' },
        { valor: 'tarjeta', texto: 'Tarjeta' },
        { valor: 'cuenta_corriente', texto: 'Cuenta corriente o fiado' },
      ],
    },
    { id: 'registro_actual', titulo: '¿Cómo llevás las cuentas hoy?', opciones: REGISTRO_ACTUAL },
    {
      id: 'preocupacion',
      titulo: '¿Qué te preocupa más de la caja?',
      opciones: [
        { valor: 'pagos', texto: 'Llegar a pagar sueldos y proveedores' },
        { valor: 'vencimientos', texto: 'Que se me pase un vencimiento' },
        { valor: 'cuotas', texto: 'Comprar en cuotas sin ahogarme' },
        { valor: 'ganancia', texto: 'Saber cuánto gano de verdad' },
      ],
    },
    { id: 'experiencia', titulo: '¿Cómo te llevás con los números?', opciones: EXPERIENCIA },
  ],
  persona: [
    {
      id: 'ocupacion',
      titulo: '¿De dónde sale tu plata?',
      opciones: [
        { valor: 'empleo', texto: 'Tengo un empleo' },
        { valor: 'independiente', texto: 'Trabajo por mi cuenta' },
        { valor: 'estudiante', texto: 'Estudio, con ayuda o una beca' },
        { valor: 'jubilacion', texto: 'Jubilación o pensión' },
        { valor: 'otra', texto: 'Otra cosa' },
      ],
    },
    {
      id: 'ingresos',
      titulo: '¿Cómo son tus ingresos?',
      opciones: [
        { valor: 'fijos', texto: 'Cobro lo mismo todos los meses' },
        { valor: 'variables', texto: 'Cambian mes a mes' },
        { valor: 'mixtos', texto: 'Una parte fija y otra variable' },
      ],
    },
    {
      id: 'hogar',
      titulo: '¿Con quién compartís los gastos?',
      opciones: [
        { valor: 'solo', texto: 'Con nadie, son solo míos' },
        { valor: 'pareja', texto: 'Con mi pareja o con quien vivo' },
        { valor: 'familia', texto: 'Tengo familia a cargo' },
      ],
    },
    {
      id: 'cuotas',
      titulo: '¿Cuántas cuotas estás pagando?',
      opciones: [
        { valor: 'ninguna', texto: 'Ninguna' },
        { valor: 'pocas', texto: 'Algunas, las tengo controladas' },
        { valor: 'muchas', texto: 'Muchas, me pesan todos los meses' },
      ],
    },
    { id: 'registro_actual', titulo: '¿Cómo llevás tus gastos hoy?', opciones: REGISTRO_ACTUAL },
    {
      id: 'objetivo',
      titulo: '¿Qué querés lograr primero?',
      opciones: [
        { valor: 'fin_de_mes', texto: 'Llegar tranquilo a fin de mes' },
        { valor: 'ahorrar', texto: 'Empezar a ahorrar' },
        { valor: 'deudas', texto: 'Salir de las deudas' },
        { valor: 'compra', texto: 'Juntar para una compra grande' },
      ],
    },
    { id: 'experiencia', titulo: '¿Cómo te llevás con los números?', opciones: EXPERIENCIA },
  ],
};
