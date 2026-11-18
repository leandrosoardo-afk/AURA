// Convierte una planilla (Excel o CSV) en movimientos. Función pura: el archivo se lee en el
// navegador y el servidor vuelve a validar cada fila que recibe.

export type Celda = string | number | boolean | Date | null | undefined;

export interface Mapeo {
  fecha: number | null;
  concepto: number | null;
  monto: number | null;
  ingreso: number | null;
  egreso: number | null;
  tipo: number | null;
  categoria: number | null;
}

export type CampoMapeo = keyof Mapeo;

export interface FilaImportada {
  tipo: 'ingreso' | 'egreso';
  monto: number;
  concepto: string;
  categoria: string;
  fecha: string;
}

export interface ResultadoConversion {
  validas: FilaImportada[];
  errores: { fila: number; motivo: string }[];
  /** Todos los montos son positivos y nada indica si entraron o salieron. */
  ambiguo: boolean;
}

export const MAXIMO_FILAS = 5000;
const MONTO_MAXIMO = 1_000_000_000_000;

const SINONIMOS: Record<CampoMapeo, string[]> = {
  fecha: ['fecha', 'dia', 'date', 'f. operacion', 'fecha operacion', 'fecha de operacion', 'fecha valor'],
  concepto: ['concepto', 'detalle', 'descripcion', 'referencia', 'motivo', 'glosa', 'movimiento'],
  monto: ['monto', 'importe', 'total', 'valor', 'pesos', 'monto ars', 'importe ars'],
  ingreso: ['ingreso', 'ingresos', 'entrada', 'entradas', 'credito', 'creditos', 'cobro', 'cobros', 'haber'],
  egreso: ['egreso', 'egresos', 'salida', 'salidas', 'debito', 'debitos', 'pago', 'pagos', 'gasto', 'gastos', 'debe'],
  tipo: ['tipo', 'tipo de movimiento', 'clase', 'ingreso/egreso', 'entrada/salida'],
  categoria: ['categoria', 'rubro', 'cuenta', 'clasificacion'],
};

const PALABRAS_INGRESO = ['ingreso', 'entrada', 'credito', 'cobro', 'venta', 'haber', 'deposito'];
const PALABRAS_EGRESO = ['egreso', 'salida', 'debito', 'pago', 'gasto', 'compra', 'debe', 'retiro'];

function normalizar(texto: unknown): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function parsearCsv(texto: string): Celda[][] {
  const limpio = texto.replace(/^﻿/, '');
  const primeraLinea = limpio.split(/\r?\n/, 1)[0] ?? '';
  const separador = [';', '\t', ','].reduce((mejor, s) => (primeraLinea.split(s).length > primeraLinea.split(mejor).length ? s : mejor), ';');

  const filas: Celda[][] = [];
  let fila: Celda[] = [];
  let celda = '';
  let entreComillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (entreComillas) {
      if (c === '"' && limpio[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (c === '"') {
        entreComillas = false;
      } else {
        celda += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === separador) {
      fila.push(celda);
      celda = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && limpio[i + 1] === '\n') i++;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = '';
    } else {
      celda += c;
    }
  }
  if (celda !== '' || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas;
}

/** Busca la fila de encabezados: muchas planillas tienen títulos arriba. */
export function detectarEncabezado(filas: Celda[][]): { indice: number; mapeo: Mapeo } {
  const vacio: Mapeo = { fecha: null, concepto: null, monto: null, ingreso: null, egreso: null, tipo: null, categoria: null };
  let mejor = { indice: 0, mapeo: vacio, aciertos: 0 };
  for (let indice = 0; indice < Math.min(filas.length, 15); indice++) {
    const mapeo: Mapeo = { ...vacio };
    let aciertos = 0;
    filas[indice].forEach((celda, columna) => {
      const texto = normalizar(celda);
      if (!texto) return;
      for (const campo of Object.keys(SINONIMOS) as CampoMapeo[]) {
        if (mapeo[campo] === null && SINONIMOS[campo].includes(texto)) {
          mapeo[campo] = columna;
          aciertos++;
          return;
        }
      }
    });
    if (aciertos > mejor.aciertos) mejor = { indice, mapeo, aciertos };
  }
  return { indice: mejor.indice, mapeo: mejor.mapeo };
}

function fechaIso(anio: number, mes: number, dia: number): string | null {
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  if (f.getUTCFullYear() !== anio || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== dia) return null;
  return f.toISOString().slice(0, 10);
}

export function parsearFecha(valor: Celda): string | null {
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor.toISOString().slice(0, 10);
  }
  if (typeof valor === 'number') {
    // Número de serie de Excel: días desde el 30/12/1899.
    if (valor < 20000 || valor > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(valor) * 864e5).toISOString().slice(0, 10);
  }
  const texto = String(valor ?? '').trim();
  const iso = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return fechaIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  // En Argentina el día va primero.
  const local = texto.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(\s|$)/);
  if (!local) return null;
  const anio = local[3].length === 2 ? 2000 + Number(local[3]) : Number(local[3]);
  return fechaIso(anio, Number(local[2]), Number(local[1]));
}

export function parsearMonto(valor: Celda): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  let texto = String(valor ?? '').trim();
  if (!texto) return null;
  const negativo = /^\(.*\)$/.test(texto) || /^-|-$|^\$\s*-|^-\s*\$/.test(texto);
  texto = texto.replace(/[^\d.,]/g, '');
  if (!/\d/.test(texto)) return null;

  const coma = texto.lastIndexOf(',');
  const punto = texto.lastIndexOf('.');
  if (coma >= 0 && punto >= 0) {
    const decimal = coma > punto ? ',' : '.';
    const miles = decimal === ',' ? '.' : ',';
    texto = texto.split(miles).join('').replace(decimal, '.');
  } else if (coma >= 0) {
    texto = /^\d{1,3}(,\d{3})+$/.test(texto) ? texto.split(',').join('') : texto.replace(',', '.');
  } else if (punto >= 0 && /^\d{1,3}(\.\d{3})+$/.test(texto)) {
    texto = texto.split('.').join('');
  }
  const numero = Number(texto);
  if (!Number.isFinite(numero)) return null;
  return negativo ? -numero : numero;
}

function tipoDePalabra(valor: Celda): 'ingreso' | 'egreso' | null {
  const texto = normalizar(valor);
  if (PALABRAS_INGRESO.some((p) => texto.startsWith(p))) return 'ingreso';
  if (PALABRAS_EGRESO.some((p) => texto.startsWith(p))) return 'egreso';
  return null;
}

export function convertirFilas(
  filas: Celda[][],
  inicio: number,
  mapeo: Mapeo,
  opciones: { positivosSon?: 'ingreso' | 'egreso' } = {},
): ResultadoConversion {
  const validas: FilaImportada[] = [];
  const errores: ResultadoConversion['errores'] = [];
  const tieneTipo = mapeo.tipo !== null || mapeo.ingreso !== null || mapeo.egreso !== null;
  let hayNegativos = false;

  const celda = (fila: Celda[], columna: number | null) => (columna === null ? null : fila[columna]);

  for (let i = inicio; i < filas.length; i++) {
    const fila = filas[i];
    const numero = i + 1;
    if (fila.every((c) => normalizar(c instanceof Date ? 'x' : c) === '')) continue;

    const fecha = parsearFecha(celda(fila, mapeo.fecha));
    if (!fecha) {
      errores.push({ fila: numero, motivo: 'La fecha no se entiende.' });
      continue;
    }

    let tipo: 'ingreso' | 'egreso' | null = null;
    let monto: number | null = null;

    const entra = parsearMonto(celda(fila, mapeo.ingreso));
    const sale = parsearMonto(celda(fila, mapeo.egreso));
    if (entra && sale) {
      errores.push({ fila: numero, motivo: 'Tiene monto de ingreso y de egreso a la vez.' });
      continue;
    }
    if (entra) {
      tipo = entra < 0 ? 'egreso' : 'ingreso';
      monto = Math.abs(entra);
    } else if (sale) {
      tipo = 'egreso';
      monto = Math.abs(sale);
    } else {
      const unico = parsearMonto(celda(fila, mapeo.monto));
      if (unico) {
        monto = Math.abs(unico);
        const palabra = tipoDePalabra(celda(fila, mapeo.tipo));
        if (unico < 0) hayNegativos = true;
        tipo = palabra ?? (unico < 0 ? 'egreso' : (opciones.positivosSon ?? 'ingreso'));
      }
    }

    if (!monto || !tipo) {
      errores.push({ fila: numero, motivo: 'No tiene monto.' });
      continue;
    }
    const redondeado = Math.round(monto);
    if (redondeado < 1 || redondeado > MONTO_MAXIMO) {
      errores.push({ fila: numero, motivo: 'El monto está fuera de rango.' });
      continue;
    }

    validas.push({
      tipo,
      monto: redondeado,
      fecha,
      concepto: String(celda(fila, mapeo.concepto) ?? '').trim().slice(0, 120) || 'Sin concepto',
      categoria: String(celda(fila, mapeo.categoria) ?? '').trim().slice(0, 60) || (tipo === 'ingreso' ? 'Otros ingresos' : 'Otros gastos'),
    });
  }

  return { validas, errores, ambiguo: !tieneTipo && !hayNegativos && validas.length > 0 };
}
