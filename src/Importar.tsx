import { useMemo, useState } from 'react';
import { Download, FileUp } from 'lucide-react';
import { convertirFilas, detectarEncabezado, MAXIMO_FILAS, parsearCsv, type CampoMapeo, type Celda, type Mapeo } from '../shared/importacion';
import { api, formatoPesos } from './api';

interface Hoja {
  nombre: string;
  filas: Celda[][];
}

const CAMPOS: { campo: CampoMapeo; nombre: string }[] = [
  { campo: 'fecha', nombre: 'Fecha' },
  { campo: 'concepto', nombre: 'Concepto' },
  { campo: 'monto', nombre: 'Monto (una sola columna)' },
  { campo: 'ingreso', nombre: 'Ingresos (columna aparte)' },
  { campo: 'egreso', nombre: 'Egresos (columna aparte)' },
  { campo: 'tipo', nombre: 'Tipo (ingreso o egreso)' },
  { campo: 'categoria', nombre: 'Categoría' },
];

function letraColumna(indice: number): string {
  return indice < 26 ? String.fromCharCode(65 + indice) : `${String.fromCharCode(64 + Math.floor(indice / 26))}${String.fromCharCode(65 + (indice % 26))}`;
}

export function Importar({ espacioId, alCambiarDatos, alCerrar }: { espacioId: string; alCambiarDatos: () => Promise<void>; alCerrar: () => void }) {
  const [hojas, setHojas] = useState<Hoja[]>([]);
  const [hojaActiva, setHojaActiva] = useState(0);
  const [inicio, setInicio] = useState(0);
  const [mapeo, setMapeo] = useState<Mapeo | null>(null);
  const [positivosSon, setPositivosSon] = useState<'ingreso' | 'egreso'>('ingreso');
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ importados: number; repetidos: number; importacionId: string | null } | null>(null);
  const [deshecho, setDeshecho] = useState(false);

  function prepararHoja(hoja: Hoja) {
    const { indice, mapeo: detectado } = detectarEncabezado(hoja.filas);
    setInicio(indice);
    setMapeo(detectado);
  }

  async function elegirArchivo(archivo: File | undefined) {
    if (!archivo) return;
    setError(null);
    setResultado(null);
    setDeshecho(false);
    setHojas([]);
    setMapeo(null);
    setNombreArchivo(archivo.name);
    const extension = archivo.name.split('.').pop()?.toLowerCase();
    try {
      let leidas: Hoja[];
      if (extension === 'csv' || extension === 'txt') {
        leidas = [{ nombre: archivo.name, filas: parsearCsv(await archivo.text()) }];
      } else if (extension === 'xlsx') {
        // La librería se carga recién acá: quien no importa nunca la descarga.
        const { default: leerExcel } = await import('read-excel-file/browser');
        const libro = await leerExcel(archivo);
        leidas = libro.map((h) => ({ nombre: h.sheet, filas: h.data as Celda[][] }));
      } else if (extension === 'xls') {
        setError('Ese formato de Excel es muy viejo. Abrí el archivo, usá "Guardar como" y elegí .xlsx.');
        return;
      } else {
        setError('Elegí un archivo .xlsx o .csv.');
        return;
      }
      const conDatos = leidas.filter((h) => h.filas.length > 0);
      if (conDatos.length === 0) {
        setError('El archivo está vacío.');
        return;
      }
      setHojas(conDatos);
      setHojaActiva(0);
      prepararHoja(conDatos[0]);
    } catch {
      setError('No pudimos leer el archivo. Revisá que no esté dañado ni protegido con contraseña.');
    }
  }

  const hoja = hojas[hojaActiva];
  const encabezados = hoja?.filas[inicio] ?? [];
  const conversion = useMemo(() => (hoja && mapeo ? convertirFilas(hoja.filas, inicio + 1, mapeo, { positivosSon }) : null), [hoja, mapeo, inicio, positivosSon]);

  const tieneFecha = mapeo?.fecha !== null && mapeo?.fecha !== undefined;
  const tieneMonto = mapeo !== null && (mapeo.monto !== null || mapeo.ingreso !== null || mapeo.egreso !== null);
  const demasiadas = (conversion?.validas.length ?? 0) > MAXIMO_FILAS;

  async function confirmar() {
    if (!conversion) return;
    setError(null);
    setEnviando(true);
    try {
      const r = await api<{ importados: number; repetidos: number; importacionId: string | null }>(`/espacios/${espacioId}/movimientos/importar`, {
        metodo: 'POST',
        cuerpo: { filas: conversion.validas },
      });
      setResultado(r);
      setHojas([]);
      setMapeo(null);
      await alCambiarDatos();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function deshacer() {
    if (!resultado?.importacionId) return;
    setError(null);
    setEnviando(true);
    try {
      await api(`/espacios/${espacioId}/importaciones/${resultado.importacionId}`, { metodo: 'DELETE' });
      setDeshecho(true);
      await alCambiarDatos();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="importar" aria-label="Importar movimientos desde Excel">
      <div className="importar__cabecera">
        <h2>Importar desde Excel</h2>
        <button className="boton-texto" onClick={alCerrar}>
          Cerrar
        </button>
      </div>

      {resultado ? (
        <div className="confirmacion" role="status">
          {deshecho ? (
            <p>Deshicimos la importación: sacamos los {resultado.importados} movimientos.</p>
          ) : (
            <>
              <p>
                Importamos {resultado.importados} {resultado.importados === 1 ? 'movimiento' : 'movimientos'}.
                {resultado.repetidos > 0 && ` Salteamos ${resultado.repetidos} que ya estaban cargados.`} Tu saldo y tu historial ya están actualizados.
              </p>
              {resultado.importacionId && (
                <button className="boton boton--secundario" disabled={enviando} onClick={deshacer}>
                  Deshacer la importación
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <div className="importar__archivo">
            <label className="boton boton--principal importar__elegir">
              <FileUp size={18} aria-hidden="true" /> Elegir archivo
              <input type="file" accept=".xlsx,.csv,.xls,.txt" onChange={(e) => elegirArchivo(e.target.files?.[0])} />
            </label>
            <a className="boton-texto" href="/plantilla_movimientos.xlsx" download>
              <Download size={16} aria-hidden="true" /> Descargar la plantilla
            </a>
            {nombreArchivo && <span className="contador">{nombreArchivo}</span>}
          </div>
          <p className="contador">Acepta .xlsx y .csv. Cada fila necesita una fecha y un monto. El archivo se lee en tu navegador y solo se guarda lo que confirmes.</p>
        </>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {hoja && mapeo && conversion && (
        <>
          {hojas.length > 1 && (
            <label className="campo importar__hoja">
              Hoja
              <select
                value={hojaActiva}
                onChange={(e) => {
                  const i = Number(e.target.value);
                  setHojaActiva(i);
                  prepararHoja(hojas[i]);
                }}
              >
                {hojas.map((h, i) => (
                  <option key={h.nombre} value={i}>
                    {h.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}

          <h3>Revisá las columnas</h3>
          <div className="importar__columnas">
            {CAMPOS.map(({ campo, nombre }) => (
              <label key={campo} className="campo">
                {nombre}
                <select
                  value={mapeo[campo] ?? ''}
                  onChange={(e) => setMapeo({ ...mapeo, [campo]: e.target.value === '' ? null : Number(e.target.value) })}
                >
                  <option value="">Sin usar</option>
                  {encabezados.map((celda, i) => (
                    <option key={i} value={i}>
                      {letraColumna(i)}: {String(celda ?? '').slice(0, 30) || 'sin título'}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {conversion.ambiguo && (
            <fieldset className="importar__ambiguo">
              <legend>Todos los montos son positivos. ¿Qué representan?</legend>
              {(['ingreso', 'egreso'] as const).map((t) => (
                <label key={t} className="casilla">
                  <input type="radio" name="positivos" checked={positivosSon === t} onChange={() => setPositivosSon(t)} />
                  {t === 'ingreso' ? 'Ingresos' : 'Gastos'}
                </label>
              ))}
            </fieldset>
          )}

          <h3>
            {conversion.validas.length} {conversion.validas.length === 1 ? 'fila lista' : 'filas listas'} para importar
          </h3>
          {conversion.validas.length > 0 && (
            <div className="tabla-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col" className="tabla__texto">Concepto</th>
                    <th scope="col" className="tabla__texto">Categoría</th>
                    <th scope="col">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {conversion.validas.slice(0, 8).map((f, i) => (
                    <tr key={i}>
                      <td>{f.fecha.split('-').reverse().join('/')}</td>
                      <td className="tabla__texto">{f.concepto}</td>
                      <td className="tabla__texto">{f.categoria}</td>
                      <td>
                        {f.tipo === 'ingreso' ? '+' : '−'}
                        {formatoPesos(f.monto)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {conversion.validas.length > 8 && <p className="contador">Mostramos las primeras 8.</p>}

          {conversion.errores.length > 0 && (
            <details className="grafico__tabla" open={conversion.validas.length === 0}>
              <summary>
                {conversion.errores.length} {conversion.errores.length === 1 ? 'fila no se va a importar' : 'filas no se van a importar'}
              </summary>
              <ul className="importar__errores">
                {conversion.errores.slice(0, 20).map((e) => (
                  <li key={e.fila}>
                    Fila {e.fila}: {e.motivo}
                  </li>
                ))}
              </ul>
              {conversion.errores.length > 20 && <p className="contador">Y {conversion.errores.length - 20} más.</p>}
            </details>
          )}

          {!tieneFecha && <p className="error">Indicá qué columna tiene la fecha.</p>}
          {!tieneMonto && <p className="error">Indicá qué columna tiene el monto.</p>}
          {demasiadas && <p className="error">Se pueden importar hasta {MAXIMO_FILAS} filas por vez. Dividí el archivo en partes.</p>}

          <button className="boton boton--principal boton--inicio" disabled={enviando || conversion.validas.length === 0 || demasiadas} onClick={confirmar}>
            {enviando ? 'Importando…' : `Importar ${conversion.validas.length} ${conversion.validas.length === 1 ? 'movimiento' : 'movimientos'}`}
          </button>
        </>
      )}
    </section>
  );
}
