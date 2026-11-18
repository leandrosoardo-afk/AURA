// Datos de mercado desde fuentes públicas. Regla: solo datos reales. Si una fuente falla se
// muestra el último dato obtenido con su fecha, o nada. Nunca un valor de respaldo escrito a mano.

import { z } from 'zod';

const AGENTE = 'Aura/4.0';
const MINUTO = 60_000;
const HORA = 60 * MINUTO;

export interface Seccion<T> {
  datos: T | null;
  fuente: string;
  obtenidoEn: string | null;
  /** La última actualización falló y estos datos son de antes. */
  desactualizado: boolean;
}

interface Entrada {
  valor: unknown;
  obtenidoEn: number;
  fallo: boolean;
  venceEn: number;
  enCurso: Promise<void> | null;
}

const cache = new Map<string, Entrada>();

export function limpiarCacheMercado(): void {
  cache.clear();
}

async function pedirJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': AGENTE }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${url} respondió ${res.status}`);
  return res.json();
}

async function conCache<T>(clave: string, fuente: string, vigencia: number, obtener: () => Promise<T>): Promise<Seccion<T>> {
  let entrada = cache.get(clave);
  if (!entrada) {
    entrada = { valor: null, obtenidoEn: 0, fallo: false, venceEn: 0, enCurso: null };
    cache.set(clave, entrada);
  }
  const actual = entrada;
  if (Date.now() >= actual.venceEn) {
    // Varios pedidos simultáneos comparten una sola consulta a la fuente.
    actual.enCurso ??= obtener()
      .then((valor) => {
        actual.valor = valor;
        actual.obtenidoEn = Date.now();
        actual.fallo = false;
        actual.venceEn = Date.now() + vigencia;
      })
      .catch((error) => {
        console.error(`Mercado: no se pudo actualizar ${clave}: ${(error as Error).message}`);
        actual.fallo = true;
        // Se reintenta pronto, sin insistirle a una fuente caída en cada pedido.
        actual.venceEn = Date.now() + 5 * MINUTO;
      })
      .finally(() => {
        actual.enCurso = null;
      });
    await actual.enCurso;
  }
  return {
    datos: actual.valor as T | null,
    fuente,
    obtenidoEn: actual.obtenidoEn ? new Date(actual.obtenidoEn).toISOString() : null,
    desactualizado: actual.fallo && actual.valor !== null,
  };
}

/** Valida fila por fila: una fila rara de la fuente se descarta, no rompe toda la sección. */
function filasValidas<T>(esquema: z.ZodType<T>, datos: unknown): T[] {
  if (!Array.isArray(datos)) throw new Error('La fuente no devolvió una lista.');
  const filas = datos.flatMap((f) => {
    const r = esquema.safeParse(f);
    return r.success ? [r.data] : [];
  });
  if (filas.length === 0) throw new Error('La fuente no devolvió filas válidas.');
  return filas;
}

const numeroPositivo = z.number().positive();

const esquemaDolar = z.object({ casa: z.string(), nombre: z.string(), compra: numeroPositivo.nullable(), venta: numeroPositivo.nullable(), fechaActualizacion: z.string() });

export function dolar() {
  return conCache('dolar', 'DolarAPI', 5 * MINUTO, async () =>
    filasValidas(esquemaDolar, await pedirJson('https://dolarapi.com/v1/dolares'))
      .filter((d) => d.compra !== null || d.venta !== null)
      .map((d) => ({ casa: d.casa, nombre: d.nombre, compra: d.compra, venta: d.venta, fecha: d.fechaActualizacion })),
  );
}

// Variables del BCRA usadas como referencia del sistema. Verificadas el 04/11/2026.
const VARIABLES_BCRA: Record<number, string> = {
  13: 'Adelantos en cuenta corriente',
  14: 'Préstamos personales',
  7: 'BADLAR de bancos privados',
  44: 'TAMAR de bancos privados',
};

const esquemaVariable = z.object({ idVariable: z.number(), ultFechaInformada: z.string(), ultValorInformado: z.number() });

export function referencias() {
  return conCache('referencias', 'BCRA, Principales Variables', 6 * HORA, async () => {
    const r = (await pedirJson('https://api.bcra.gob.ar/estadisticas/v4.0/monetarias?limit=2000')) as { results?: unknown };
    return filasValidas(esquemaVariable, r.results)
      .filter((v) => VARIABLES_BCRA[v.idVariable])
      .map((v) => ({ id: v.idVariable, nombre: VARIABLES_BCRA[v.idVariable], tna: v.ultValorInformado, fecha: v.ultFechaInformada }));
  });
}

const textoOpcional = z.string().nullish();
const numeroOpcional = z.number().nullish();

const esquemaPrestamo = z.object({
  descripcionEntidad: z.string(),
  nombreCompleto: textoOpcional,
  denominacion: textoOpcional,
  tipoTasa: textoOpcional,
  beneficiario: textoOpcional,
  tasaEfectivaAnualMaxima: numeroOpcional,
  costoFinancieroEfectivoTotalMaximo: z.number(),
  plazoMaximoOtorgable: numeroOpcional,
  montoMaximoOtorgable: numeroOpcional,
  ingresoMinimoMensual: numeroOpcional,
  fechaInformacion: z.string(),
  masInformacion: textoOpcional,
});

export type TipoCredito = 'Personales' | 'Prendarios' | 'Hipotecarios';

export interface LineaCredito {
  entidad: string;
  producto: string;
  moneda: string;
  tasa: string | null;
  beneficiario: string;
  tea: number | null;
  cft: number;
  plazoMeses: number | null;
  montoMaximo: number | null;
  ingresoMinimo: number | null;
  fecha: string;
  nota: string | null;
}

const DIAS_VIGENCIA_CREDITO = 180;
const CFT_MAXIMO_CREIBLE = 1000;

/**
 * La fuente incluye líneas de hace años, costos imposibles y campos vacíos. Se conservan las
 * informadas en los últimos meses y, por cada entidad y beneficiario, la de menor costo.
 */
export function depurarCreditos(filas: z.infer<typeof esquemaPrestamo>[], hoy: string): LineaCredito[] {
  const desde = new Date(Date.parse(`${hoy}T00:00:00Z`) - DIAS_VIGENCIA_CREDITO * 864e5).toISOString().slice(0, 10);
  const mejores = new Map<string, LineaCredito>();
  for (const f of filas) {
    // Algunas entidades informan una línea UVA como si fuera en pesos: el nombre lo delata.
    const moneda = /\bUVA\b/i.test(f.nombreCompleto ?? '') ? 'UVA' : f.denominacion?.trim();
    if (moneda !== 'Pesos' && moneda !== 'UVA') continue;
    const cft = f.costoFinancieroEfectivoTotalMaximo;
    if (!(cft > 0) || cft > CFT_MAXIMO_CREIBLE || f.fechaInformacion < desde) continue;
    const beneficiario = f.beneficiario?.trim() || 'Sin especificar';
    const clave = `${f.descripcionEntidad}|${beneficiario}|${moneda}`;
    const actual = mejores.get(clave);
    if (actual && actual.cft <= cft) continue;
    const nota = f.masInformacion?.trim();
    mejores.set(clave, {
      entidad: f.descripcionEntidad.trim(),
      producto: f.nombreCompleto?.trim() || 'Sin nombre',
      moneda,
      tasa: f.tipoTasa?.trim() || null,
      beneficiario,
      tea: f.tasaEfectivaAnualMaxima ?? null,
      cft,
      plazoMeses: f.plazoMaximoOtorgable ?? null,
      montoMaximo: f.montoMaximoOtorgable ?? null,
      ingresoMinimo: f.ingresoMinimoMensual ?? null,
      fecha: f.fechaInformacion,
      nota: nota && nota !== '0' ? nota.slice(0, 400) : null,
    });
  }
  return [...mejores.values()].sort((a, b) => a.cft - b.cft);
}

/**
 * Los cinco bancos con más depósitos del sistema (BCRA, cierre de 2025), en ese orden.
 * Se comparan por nombre exacto: "Santander Consumer" o el Banco Provincia del Neuquén son otras entidades.
 */
export const BANCOS_PRINCIPALES = [
  { nombre: 'Banco Nación', fuente: 'BANCO DE LA NACION ARGENTINA' },
  { nombre: 'Banco Galicia', fuente: 'BANCO DE GALICIA Y BUENOS AIRES S.A.' },
  { nombre: 'Banco Santander', fuente: 'BANCO SANTANDER ARGENTINA S.A.' },
  { nombre: 'BBVA', fuente: 'BANCO BBVA ARGENTINA S.A.' },
  { nombre: 'Banco Provincia', fuente: 'BANCO DE LA PROVINCIA DE BUENOS AIRES' },
];

const sinTildes = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();

function esBanco(entidad: string, fuente: string): boolean {
  return sinTildes(entidad) === sinTildes(fuente);
}

export interface CreditoBanco {
  banco: string;
  linea: LineaCredito | null;
}

/**
 * Una línea por banco: la de menor costo en pesos para todo público. Si no hay, la de menor costo
 * en pesos, y si el banco solo tiene UVA, la UVA. Un banco sin líneas vigentes queda con null.
 */
export function resumirCreditos(lineas: LineaCredito[]): CreditoBanco[] {
  return BANCOS_PRINCIPALES.map(({ nombre, fuente }) => {
    const delBanco = lineas.filter((l) => esBanco(l.entidad, fuente));
    const enPesos = delBanco.filter((l) => l.moneda === 'Pesos');
    const candidatas = enPesos.length > 0 ? enPesos : delBanco;
    const generales = candidatas.filter((l) => l.beneficiario === 'Todos los beneficiarios');
    const linea = [...(generales.length > 0 ? generales : candidatas)].sort((a, b) => a.cft - b.cft)[0] ?? null;
    return { banco: nombre, linea };
  });
}

export function creditos(tipo: TipoCredito, hoy: string) {
  return conCache(`creditos-${tipo}`, 'BCRA, Régimen de Transparencia', 6 * HORA, async () => {
    const r = (await pedirJson(`https://api.bcra.gob.ar/transparencia/v1.0/Prestamos/${tipo}`)) as { results?: unknown };
    return resumirCreditos(depurarCreditos(filasValidas(esquemaPrestamo, r.results), hoy));
  });
}

const esquemaPlazoFijo = z.object({ entidad: z.string(), tnaClientes: numeroOpcional, tnaNoClientes: numeroOpcional });

export function plazoFijo() {
  return conCache('plazoFijo', 'ArgentinaDatos, según BCRA', 6 * HORA, async () =>
    filasValidas(esquemaPlazoFijo, await pedirJson('https://api.argentinadatos.com/v1/finanzas/tasas/plazoFijo'))
      .filter((f) => (f.tnaClientes ?? 0) > 0)
      .flatMap((f) => {
        const banco = BANCOS_PRINCIPALES.find((b) => esBanco(f.entidad, b.fuente));
        return banco ? [{ entidad: banco.nombre, tnaClientes: (f.tnaClientes as number) * 100, tnaNoClientes: f.tnaNoClientes ? f.tnaNoClientes * 100 : null }] : [];
      })
      .sort((a, b) => b.tnaClientes - a.tnaClientes),
  );
}

const esquemaLetra = z.object({ ticker: z.string(), tnaPorcentaje: z.number(), teaPorcentaje: numeroOpcional, fechaVencimiento: z.string(), precioArs: numeroOpcional });

export function letras(hoy: string) {
  return conCache('letras', 'ArgentinaDatos', 6 * HORA, async () => {
    const r = (await pedirJson('https://api.argentinadatos.com/v1/finanzas/letras')) as { letras?: unknown };
    return filasValidas(esquemaLetra, r.letras)
      .filter((l) => l.fechaVencimiento >= hoy)
      .map((l) => ({ ticker: l.ticker, tna: l.tnaPorcentaje, tea: l.teaPorcentaje ?? null, vencimiento: l.fechaVencimiento }))
      .sort((a, b) => a.vencimiento.localeCompare(b.vencimiento));
  });
}

const esquemaFondo = z.object({ fondo: z.string(), fecha: z.string(), vcp: z.number().positive(), patrimonio: z.number().nullish() });

/** El rendimiento se calcula con el valor de la cuotaparte hoy contra unos 30 días atrás. */
async function fondosDe(categoria: 'mercadoDinero' | 'rentaFija', hoy: string, nombre: string) {
  const base = `https://api.argentinadatos.com/v1/finanzas/fci/${categoria}`;
  const ultimos = filasValidas(esquemaFondo, await pedirJson(`${base}/ultimo`));
  const elegidos = ultimos
    .filter((f) => !/d[oó]lar|usd|u\$s/i.test(f.fondo))
    .sort((a, b) => (b.patrimonio ?? 0) - (a.patrimonio ?? 0))
    .slice(0, 15);

  // Algunos días la fuente trae pocos fondos o ninguno: se busca a cada fondo en la semana previa.
  const previo = new Map<string, z.infer<typeof esquemaFondo>>();
  for (let atras = 30; atras <= 37 && previo.size < elegidos.length; atras++) {
    const f = new Date(Date.parse(`${hoy}T00:00:00Z`) - atras * 864e5).toISOString().slice(0, 10).replace(/-/g, '/');
    try {
      for (const fondo of filasValidas(esquemaFondo, await pedirJson(`${base}/${f}`))) {
        if (!previo.has(fondo.fondo) && elegidos.some((e) => e.fondo === fondo.fondo)) previo.set(fondo.fondo, fondo);
      }
    } catch {
      // Feriado o fin de semana: se sigue con el día anterior.
    }
  }
  return elegidos.map((f) => {
    const antes = previo.get(f.fondo);
    const dias = antes ? Math.round((Date.parse(f.fecha) - Date.parse(antes.fecha)) / 864e5) : 0;
    const rendimiento = antes && dias > 0 ? (f.vcp / antes.vcp - 1) * 100 : null;
    return {
      fondo: f.fondo,
      categoria: nombre,
      fecha: f.fecha,
      rendimiento: rendimiento !== null && Math.abs(rendimiento) < 50 ? rendimiento : null,
      dias: rendimiento !== null ? dias : null,
      patrimonio: f.patrimonio ?? null,
    };
  });
}

export function fondos(hoy: string) {
  return conCache('fondos', 'ArgentinaDatos, según CAFCI', 6 * HORA, async () => {
    const [dinero, fija] = await Promise.allSettled([fondosDe('mercadoDinero', hoy, 'Mercado de dinero'), fondosDe('rentaFija', hoy, 'Renta fija')]);
    const todos = [dinero, fija].flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    if (todos.length === 0) throw new Error('Ninguna categoría de fondos respondió.');
    return todos;
  });
}
