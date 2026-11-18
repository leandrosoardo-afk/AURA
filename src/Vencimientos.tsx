import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CalendarCheck, CalendarClock, CalendarPlus, Check, History, Repeat, RotateCcw, Trash2 } from 'lucide-react';
import { fechaCorta, fmt, sumarDias } from '../shared/motor';
import { api, fechaDeHoy, type Yo } from './api';
import { CampoPesos, digitos } from './comunes';

interface Compromiso {
  id: string;
  /** 'movimiento': gasto o ingreso cargado con fecha futura, que se descuenta solo ese día. */
  origen: 'agenda' | 'movimiento';
  tipo: 'pago' | 'cobro';
  monto: number;
  concepto: string;
  categoria: string;
  fecha: string;
  mensual: boolean;
  dias: number;
  saldoEseDia: number | null;
}

/** Lo que ya se pagó o cobró, y lo que se eliminó de la agenda. */
interface EnHistorial {
  id: string;
  tipo: 'pago' | 'cobro';
  monto: number;
  concepto: string;
  categoria: string;
  fecha: string;
  estado: 'pagado' | 'anulado';
  mensual: boolean;
  cuando: string;
}

const GRUPOS: { titulo: string; incluye: (dias: number) => boolean }[] = [
  { titulo: 'Vencidos', incluye: (d) => d < 0 },
  { titulo: 'Esta semana', incluye: (d) => d >= 0 && d <= 7 },
  { titulo: 'La semana que viene', incluye: (d) => d > 7 && d <= 14 },
  { titulo: 'Más adelante', incluye: (d) => d > 14 },
];

export function Vencimientos({
  yo,
  espacioId,
  consulta,
  version,
  alCambiarDatos,
}: {
  yo: Yo;
  espacioId: string;
  /** La parte "?…" de la dirección: ?tipo=pago|cobro&dias=7 llega desde las tarjetas del Inicio. */
  consulta: string;
  version: number;
  alCambiarDatos: () => Promise<void>;
}) {
  const [lista, setLista] = useState<Compromiso[] | null>(null);
  const [verTipo, setVerTipo] = useState<'todos' | 'pago' | 'cobro'>(() => {
    const t = new URLSearchParams(consulta).get('tipo');
    return t === 'pago' || t === 'cobro' ? t : 'todos';
  });
  const [soloSemana, setSoloSemana] = useState(() => new URLSearchParams(consulta).get('dias') === '7');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aBorrar, setABorrar] = useState<string | null>(null);
  const [historial, setHistorial] = useState<EnHistorial[]>([]);
  const [aDeshacer, setADeshacer] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [r, h] = await Promise.all([
        api<{ compromisos: Compromiso[] }>(`/espacios/${espacioId}/compromisos`),
        api<{ historial: EnHistorial[] }>(`/espacios/${espacioId}/compromisos/historial`),
      ]);
      setLista(r.compromisos);
      setHistorial(h.historial);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [espacioId]);

  useEffect(() => {
    void cargar();
  }, [cargar, version]);

  // "Próximos 7 días" coincide con las tarjetas del Inicio: pagos vencidos incluidos, cobros atrasados no.
  const visibles = (lista ?? []).filter(
    (c) => (verTipo === 'todos' || c.tipo === verTipo) && (!soloSemana || (c.dias <= 7 && (c.tipo === 'pago' || c.dias >= 0))),
  );

  async function accion(ruta: string, opciones: { metodo: string; cuerpo?: unknown }, mensaje: string, moverPlata = false) {
    setError(null);
    setAviso(null);
    try {
      await api(`/espacios/${espacioId}/compromisos/${ruta}`, opciones);
      setABorrar(null);
      setADeshacer(null);
      setAviso(mensaje);
      await Promise.all([cargar(), moverPlata ? alCambiarDatos() : Promise.resolve()]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function borrarProgramado(id: string) {
    setError(null);
    setAviso(null);
    try {
      await api(`/espacios/${espacioId}/movimientos/${id}`, { metodo: 'DELETE' });
      setABorrar(null);
      setAviso('Lo sacamos de tus movimientos programados. Si fue un error, lo restaurás en Movimientos, en "Eliminados".');
      await Promise.all([cargar(), alCambiarDatos()]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="pantalla movimientos">
      <h1 className="titulo-pantalla">Pagos y cobros futuros</h1>

      <FormularioCompromiso
        yo={yo}
        espacioId={espacioId}
        alAgendar={async () => {
          setAviso(null);
          await Promise.all([cargar(), alCambiarDatos()]);
        }}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {aviso && (
        <p className="aviso" role="status">
          {aviso}
        </p>
      )}

      <div className="lista">
        {lista === null && !error && <div className="esqueleto" aria-busy="true" />}
        {lista && lista.length > 0 && (
          <section className="card filtros" aria-label="Filtrar">
            <div className="segmentado segmentado--tres" role="group" aria-label="Qué mostrar">
              {(
                [
                  ['todos', 'Todos'],
                  ['pago', 'Pagos'],
                  ['cobro', 'Cobros'],
                ] as ['todos' | 'pago' | 'cobro', string][]
              ).map(([t, nombre]) => (
                <button key={t} type="button" aria-pressed={verTipo === t} onClick={() => setVerTipo(t)}>
                  {nombre}
                </button>
              ))}
            </div>
            <label className="casilla">
              <input type="checkbox" checked={soloSemana} onChange={(e) => setSoloSemana(e.target.checked)} />
              Solo los próximos 7 días
            </label>
            <p className="filtros__totales" role="status">
              <span>
                {visibles.length} {visibles.length === 1 ? 'pendiente' : 'pendientes'}
              </span>
              {verTipo !== 'cobro' && <span className="filtros__salio">Pagos {fmt(visibles.filter((c) => c.tipo === 'pago').reduce((s, c) => s + c.monto, 0))}</span>}
              {verTipo !== 'pago' && <span className="monto--ingreso">Cobros {fmt(visibles.filter((c) => c.tipo === 'cobro').reduce((s, c) => s + c.monto, 0))}</span>}
            </p>
          </section>
        )}
        {lista?.length === 0 && (
          <div className="vacio">
            <CalendarPlus size={32} strokeWidth={1.5} aria-hidden="true" />
            <p>No tenés pagos ni cobros agendados. Sumá el próximo alquiler o proveedor para verlo en tu caja.</p>
          </div>
        )}
        {lista && lista.length > 0 && visibles.length === 0 && (
          <div className="vacio">
            <p>No hay nada con este filtro.</p>
            <button
              className="boton boton--secundario"
              onClick={() => {
                setVerTipo('todos');
                setSoloSemana(false);
              }}
            >
              Ver todos
            </button>
          </div>
        )}
        {GRUPOS.map(({ titulo, incluye }) => {
          const items = visibles.filter((c) => incluye(c.dias));
          if (items.length === 0) return null;
          return (
            <section key={titulo} className="dia">
              <h2>{titulo}</h2>
              <ul>
                {items.map((c) => {
                  const esPago = c.tipo === 'pago';
                  return (
                    <li key={c.id} className="compromiso">
                      {c.origen === 'movimiento' ? (
                        <span className="tilde tilde--automatica" title="Se descuenta solo ese día">
                          <CalendarCheck size={18} aria-hidden="true" />
                        </span>
                      ) : (
                      <button
                        className="tilde"
                        aria-label={`Marcar ${c.concepto} como ${esPago ? 'pagado' : 'cobrado'}`}
                        title={esPago ? 'Marcar pagado' : 'Marcar cobrado'}
                        onClick={() => accion(`${c.id}/pagar`, { metodo: 'POST' }, esPago ? 'Pago registrado en tus movimientos.' : 'Cobro registrado en tus movimientos.', true)}
                      >
                        <Check size={18} aria-hidden="true" />
                      </button>
                      )}
                      <div className="compromiso__texto">
                        <strong>{c.concepto}</strong>
                        <small>
                          {fechaCorta(c.fecha)}. {c.categoria}
                          {c.mensual && (
                            <>
                              {' '}
                              <Repeat size={12} aria-label="Todos los meses" />
                            </>
                          )}
                        </small>
                        {c.saldoEseDia !== null && <small>Ese día te quedarían {fmt(c.saldoEseDia)}</small>}
                        {c.origen === 'movimiento' && <small className="compromiso__automatico">Programado en Movimientos: se descuenta solo ese día.</small>}
                      </div>
                      <span className={esPago ? 'monto' : 'monto monto--ingreso'}>
                        {esPago ? '−' : '+'}
                        {fmt(c.monto)}
                      </span>
                      <div className="compromiso__acciones">
                        {aBorrar === c.id ? (
                          <>
                            <button
                              className="boton-texto boton-texto--peligro"
                              onClick={() => (c.origen === 'movimiento' ? borrarProgramado(c.id) : accion(c.id, { metodo: 'DELETE' }, 'Lo pasamos al historial, abajo de todo. Si fue un error, lo volvés a agendar desde ahí.', true))}
                            >
                              Borrar
                            </button>
                            <button className="boton-texto" onClick={() => setABorrar(null)}>
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            {c.origen === 'agenda' && (
                              <button className="boton-texto" onClick={() => accion(`${c.id}/reprogramar`, { metodo: 'POST', cuerpo: { dias: 7 } }, 'Lo pasamos 7 días.')}>
                                <CalendarClock size={16} aria-hidden="true" /> 7 días más
                              </button>
                            )}
                            <button className="boton-icono" aria-label={`Borrar ${c.concepto}`} onClick={() => setABorrar(c.id)}>
                              <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        {historial.length > 0 && (
          <details className="card historial">
            <summary>
              <History size={18} aria-hidden="true" /> Historial: pagados, cobrados y eliminados ({historial.length})
            </summary>
            <p className="contador">
              Lo que marcaste como pagado o cobrado ya está en tus movimientos. Si lo deshacés, se saca de tus movimientos y vuelve a figurar como pendiente.
            </p>
            <ul>
              {historial.map((h) => {
                const esPago = h.tipo === 'pago';
                const pagado = h.estado === 'pagado';
                return (
                  <li key={h.id} className="compromiso compromiso--historial">
                    <span className={`historial__estado historial__estado--${h.estado}`}>{pagado ? (esPago ? 'Pagado' : 'Cobrado') : 'Eliminado'}</span>
                    <div className="compromiso__texto">
                      <strong>{h.concepto}</strong>
                      <small>
                        {esPago ? 'Vencía' : 'Se cobraba'} el {fechaCorta(h.fecha)}. {pagado ? (esPago ? 'Pagado' : 'Cobrado') : 'Eliminado'} el {fechaCorta(h.cuando)}.
                      </small>
                    </div>
                    <span className={esPago ? 'monto' : 'monto monto--ingreso'}>
                      {esPago ? '−' : '+'}
                      {fmt(h.monto)}
                    </span>
                    <div className="compromiso__acciones">
                      {pagado ? (
                        aDeshacer === h.id ? (
                          <>
                            <button
                              className="boton-texto boton-texto--peligro"
                              onClick={() =>
                                accion(`${h.id}/deshacer-pago`, { metodo: 'POST' }, `Listo: "${h.concepto}" vuelve a figurar como ${esPago ? 'a pagar' : 'a cobrar'} y se sacó de tus movimientos.`, true)
                              }
                            >
                              {esPago ? 'Deshacer pago' : 'Deshacer cobro'}
                            </button>
                            <button className="boton-texto" onClick={() => setADeshacer(null)}>
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <button className="boton-texto" onClick={() => setADeshacer(h.id)}>
                            <RotateCcw size={16} aria-hidden="true" /> {esPago ? 'Deshacer pago' : 'Deshacer cobro'}
                          </button>
                        )
                      ) : (
                        <button className="boton-texto" onClick={() => accion(`${h.id}/restaurar`, { metodo: 'POST' }, `Volvimos a agendar "${h.concepto}".`, true)}>
                          <RotateCcw size={16} aria-hidden="true" /> Volver a agendar
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

/** El formulario para agendar un pago o un cobro futuro. Lo usan esta pantalla y el botón + de arriba. */
export function FormularioCompromiso({
  yo,
  espacioId,
  alAgendar,
  enfocar = false,
}: {
  yo: Yo;
  espacioId: string;
  alAgendar: (tipo: 'pago' | 'cobro') => Promise<void> | void;
  enfocar?: boolean;
}) {
  const [tipo, setTipo] = useState<'pago' | 'cobro'>('pago');
  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');
  const [categoria, setCategoria] = useState<string | null>(null);
  const [fecha, setFecha] = useState(() => sumarDias(fechaDeHoy(), 7));
  const [mensual, setMensual] = useState(false);
  const [avisoDias, setAvisoDias] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const categorias = yo.adaptacion.categorias[tipo === 'pago' ? 'egreso' : 'ingreso'];

  async function agendar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    if (!categoria) {
      setError('Elegí una categoría.');
      return;
    }
    setEnviando(true);
    try {
      await api(`/espacios/${espacioId}/compromisos`, { metodo: 'POST', cuerpo: { tipo, monto: digitos(monto), concepto, categoria, fecha, mensual, avisoDias } });
      setMonto('');
      setConcepto('');
      setCategoria(null);
      setMensual(false);
      setAviso(tipo === 'pago' ? 'Pago agendado.' : 'Cobro agendado.');
      await alAgendar(tipo);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
      <form className="registro" onSubmit={agendar}>
        <div className="segmentado" role="group" aria-label="Tipo">
          {(['pago', 'cobro'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tipo === t}
              onClick={() => {
                setTipo(t);
                setCategoria(null);
              }}
            >
              {t === 'pago' ? 'Pago' : 'Cobro'}
            </button>
          ))}
        </div>
        <CampoPesos etiqueta="Monto" valor={monto} alCambiar={setMonto} autoFocus={enfocar} />
        <label className="campo">
          Concepto
          <input required maxLength={120} placeholder={tipo === 'pago' ? '¿Qué tenés que pagar?' : '¿Qué vas a cobrar?'} value={concepto} onChange={(e) => setConcepto(e.target.value)} />
        </label>
        <fieldset className="categorias">
          <legend>Categoría</legend>
          {categorias.map((c) => (
            <button key={c} type="button" className={`chip${categoria === c ? ' chip--elegido' : ''}`} aria-pressed={categoria === c} onClick={() => setCategoria(c)}>
              {c}
            </button>
          ))}
        </fieldset>
        <label className="campo">
          Fecha
          <input type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </label>
        <label className="campo">
          Avisarme
          <select value={avisoDias} onChange={(e) => setAvisoDias(Number(e.target.value))}>
            {[0, 1, 2, 3, 5, 7].map((d) => (
              <option key={d} value={d}>
                {d === 0 ? 'El mismo día' : d === 1 ? '1 día antes' : `${d} días antes`}
              </option>
            ))}
          </select>
        </label>
        <label className="casilla">
          <input type="checkbox" checked={mensual} onChange={(e) => setMensual(e.target.checked)} />
          Se repite todos los meses
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="aviso" role="status">
          {aviso}
        </p>
        <button className="boton boton--principal" disabled={enviando}>
          {enviando ? 'Agendando…' : tipo === 'pago' ? 'Agendar pago' : 'Agendar cobro'}
        </button>
      </form>
  );
}
