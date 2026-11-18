import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, History, RotateCcw, Trash2 } from 'lucide-react';
import { fechaCorta, sumarDias } from '../shared/motor';
import { api, fechaDeHoy, formatoPesos, type Movimiento, type Resumen, type Yo } from './api';
import { Importar } from './Importar';
import { FormularioMovimiento } from './RegistroRapido';

type Rango = 'todo' | 'hoy' | 'semana' | 'mes' | 'mesPasado' | 'programados' | 'elegido';
type Tipo = 'todos' | 'ingreso' | 'egreso';

const RANGOS: [Rango, string][] = [
  ['todo', 'Todo'],
  ['hoy', 'Hoy'],
  ['semana', 'Últimos 7 días'],
  ['mes', 'Este mes'],
  ['mesPasado', 'Mes pasado'],
  ['programados', 'Programados'],
  ['elegido', 'Elegir fechas'],
];

/** Las fechas de cada atajo, calculadas con el día de hoy. */
function fechasDe(rango: Rango, hoy: string): { desde: string; hasta: string } {
  const inicioMes = `${hoy.slice(0, 8)}01`;
  const finDe = (inicio: string) => sumarDias(`${sumarDias(inicio, 32).slice(0, 8)}01`, -1);
  switch (rango) {
    case 'hoy':
      return { desde: hoy, hasta: hoy };
    case 'semana':
      return { desde: sumarDias(hoy, -6), hasta: hoy };
    case 'mes':
      return { desde: inicioMes, hasta: finDe(inicioMes) };
    case 'mesPasado': {
      const inicio = `${sumarDias(inicioMes, -1).slice(0, 8)}01`;
      return { desde: inicio, hasta: finDe(inicio) };
    }
    case 'programados':
      return { desde: sumarDias(hoy, 1), hasta: '' };
    default:
      return { desde: '', hasta: '' };
  }
}

function nombreDelDia(fecha: string, hoy: string): string {
  if (fecha === hoy) return 'Hoy';
  if (fecha === sumarDias(hoy, -1)) return 'Ayer';
  return fecha.slice(0, 4) === hoy.slice(0, 4) ? fechaCorta(fecha) : `${fechaCorta(fecha)}/${fecha.slice(0, 4)}`;
}

/** Lee los filtros que llegan en la dirección, por ejemplo desde una tarjeta del Inicio. */
function filtroInicial(consulta: string) {
  const p = new URLSearchParams(consulta);
  const tipo = p.get('tipo');
  const rango = p.get('rango') as Rango | null;
  return {
    tipo: (tipo === 'ingreso' || tipo === 'egreso' ? tipo : 'todos') as Tipo,
    rango: rango && RANGOS.some(([r]) => r === rango) ? rango : p.get('desde') || p.get('hasta') ? ('elegido' as Rango) : ('todo' as Rango),
    desde: p.get('desde') ?? '',
    hasta: p.get('hasta') ?? '',
  };
}

interface Eliminado {
  id: string;
  tipo: 'ingreso' | 'egreso';
  monto: number;
  concepto: string;
  categoria: string;
  fecha: string;
  /** Era el pago de algo agendado en Pagos y cobros futuros. */
  deAgenda: boolean;
  eliminado: string;
}

interface Lista {
  movimientos: Movimiento[];
  filtro: { cantidad: number; ingresos: number; egresos: number; recortado: boolean };
}

export function Movimientos({
  yo,
  espacioId,
  consulta,
  version,
  resumen,
  recargar,
  alRegistrar,
}: {
  yo: Yo;
  espacioId: string;
  consulta: string;
  version: number;
  resumen: Resumen | null;
  recargar: () => Promise<void>;
  alRegistrar: (registro: { id: string; tipo: 'ingreso' | 'egreso'; fecha: string }) => Promise<void>;
}) {
  const hoy = fechaDeHoy();
  const [inicial] = useState(() => filtroInicial(consulta));
  const [rango, setRango] = useState<Rango>(inicial.rango);
  const [tipo, setTipo] = useState<Tipo>(inicial.tipo);
  const [desdeElegido, setDesdeElegido] = useState(inicial.desde);
  const [hastaElegido, setHastaElegido] = useState(inicial.hasta);
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aBorrar, setABorrar] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [eliminados, setEliminados] = useState<Eliminado[]>([]);
  // Cada pedido lleva un número: si el filtro cambia rápido, solo se usa la respuesta del último.
  const ultimoPedido = useRef(0);

  const { desde, hasta } = rango === 'elegido' ? { desde: desdeElegido, hasta: hastaElegido } : fechasDe(rango, hoy);
  const fechasInvalidas = Boolean(desde && hasta && desde > hasta);

  const cargarLista = useCallback(async () => {
    if (fechasInvalidas) return;
    const p = new URLSearchParams();
    if (desde) p.set('desde', desde);
    if (hasta) p.set('hasta', hasta);
    if (tipo !== 'todos') p.set('tipo', tipo);
    const pedido = ++ultimoPedido.current;
    try {
      const respuesta = await api<Lista>(`/espacios/${espacioId}/movimientos${p.size ? `?${p}` : ''}`);
      if (pedido !== ultimoPedido.current) return;
      setLista(respuesta);
      setError(null);
    } catch (err) {
      if (pedido === ultimoPedido.current) setError((err as Error).message);
    }
  }, [espacioId, desde, hasta, tipo, fechasInvalidas]);

  // Se recarga sola al cambiar el filtro y cada vez que cambian los datos (version).
  useEffect(() => {
    void cargarLista();
  }, [cargarLista, version]);

  useEffect(() => {
    api<{ eliminados: Eliminado[] }>(`/espacios/${espacioId}/movimientos-eliminados`)
      .then((r) => setEliminados(r.eliminados))
      .catch(() => setEliminados([]));
  }, [espacioId, version]);

  async function borrar(id: string) {
    setError(null);
    setAviso(null);
    try {
      const r = await api<{ volvioAPendiente: boolean; concepto: string }>(`/espacios/${espacioId}/movimientos/${id}`, { metodo: 'DELETE' });
      setABorrar(null);
      setAviso(
        r.volvioAPendiente
          ? `Lo borramos. Como era un pago agendado, "${r.concepto}" volvió a Pagos y cobros futuros como pendiente.`
          : 'Lo borramos. Si fue un error, lo restaurás abajo, en "Eliminados".',
      );
      await recargar();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function restaurar(e: Eliminado) {
    setError(null);
    setAviso(null);
    try {
      await api(`/espacios/${espacioId}/movimientos-eliminados/${e.id}/restaurar`, { metodo: 'POST' });
      setAviso(e.deAgenda ? `Restauramos "${e.concepto}" y volvió a figurar como pagado.` : `Restauramos "${e.concepto}".`);
      await recargar();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Lo que tiene fecha futura va aparte: todavía no pasó y se descuenta solo ese día.
  const movimientos = lista?.movimientos ?? [];
  const programados = movimientos.filter((m) => m.fecha > hoy).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const dias = new Map<string, Movimiento[]>();
  for (const m of movimientos) if (m.fecha <= hoy) dias.set(m.fecha, [...(dias.get(m.fecha) ?? []), m]);
  const filtrando = rango !== 'todo' || tipo !== 'todos';

  const fila = (m: Movimiento, detalle: string) => (
    <li key={m.id} className="movimiento">
      <div>
        <strong>{m.concepto}</strong>
        <small>{detalle}</small>
      </div>
      <span className={m.tipo === 'ingreso' ? 'monto monto--ingreso' : 'monto'}>
        {m.tipo === 'ingreso' ? '+' : '−'}
        {formatoPesos(m.monto)}
      </span>
      {aBorrar === m.id ? (
        <span className="borrar">
          <button className="boton-texto boton-texto--peligro" onClick={() => borrar(m.id)}>
            Borrar
          </button>
          <button className="boton-texto" onClick={() => setABorrar(null)}>
            Cancelar
          </button>
        </span>
      ) : (
        <button className="boton-icono" aria-label={`Borrar ${m.concepto}`} onClick={() => setABorrar(m.id)}>
          <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </li>
  );

  return (
    <div className="pantalla movimientos">
      <h1 className="titulo-pantalla">Movimientos</h1>
      {importando && <Importar espacioId={espacioId} alCambiarDatos={recargar} alCerrar={() => setImportando(false)} />}

      <FormularioMovimiento yo={yo} espacioId={espacioId} resumen={resumen} alRegistrar={alRegistrar} alImportar={() => setImportando(true)} />

      <div className="lista">
        <section className="card filtros" aria-label="Filtrar movimientos">
          <div className="filtros__chips" role="group" aria-label="Fechas">
            {RANGOS.map(([r, nombre]) => (
              <button key={r} type="button" className={`chip${rango === r ? ' chip--elegido' : ''}`} aria-pressed={rango === r} onClick={() => setRango(r)}>
                {nombre}
              </button>
            ))}
          </div>
          {rango === 'elegido' && (
            <div className="filtros__fechas">
              <label className="campo">
                Desde
                <input type="date" value={desdeElegido} max={hastaElegido || undefined} onChange={(e) => setDesdeElegido(e.target.value)} />
              </label>
              <label className="campo">
                Hasta
                <input type="date" value={hastaElegido} min={desdeElegido || undefined} onChange={(e) => setHastaElegido(e.target.value)} />
              </label>
            </div>
          )}
          <div className="segmentado segmentado--tres" role="group" aria-label="Tipo de movimiento">
            {(
              [
                ['todos', 'Todos'],
                ['ingreso', 'Ingresos'],
                ['egreso', 'Gastos'],
              ] as [Tipo, string][]
            ).map(([t, nombre]) => (
              <button key={t} type="button" aria-pressed={tipo === t} onClick={() => setTipo(t)}>
                {nombre}
              </button>
            ))}
          </div>
          {fechasInvalidas ? (
            <p className="error" role="alert">
              La fecha desde tiene que ser anterior a la fecha hasta.
            </p>
          ) : (
            lista && (
              <p className="filtros__totales" role="status">
                <span>
                  {lista.filtro.cantidad} {lista.filtro.cantidad === 1 ? 'movimiento' : 'movimientos'}
                  {desde || hasta ? ` ${desde ? `del ${fechaCorta(desde)}` : 'hasta'}${hasta ? `${desde ? ' al' : ''} ${fechaCorta(hasta)}` : ' en adelante'}` : ''}
                </span>
                {tipo !== 'egreso' && <span className="monto--ingreso">Entró {formatoPesos(lista.filtro.ingresos)}</span>}
                {tipo !== 'ingreso' && <span className="filtros__salio">Salió {formatoPesos(lista.filtro.egresos)}</span>}
              </p>
            )
          )}
          {lista?.filtro.recortado && <p className="contador">Mostramos los 1000 más recientes. Achicá el rango de fechas para ver el resto.</p>}
        </section>

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
        {yo.plan.incluye_publicidad && (
          <aside className="publicidad" aria-label="Publicidad">
            <span className="publicidad__rotulo">Publicidad</span>
            <p>Anuncio de ejemplo. Acá se muestra la publicidad del plan Gratis.</p>
          </aside>
        )}
        {programados.length > 0 && (
          <section className="dia dia--programados">
            <h2>Programados</h2>
            <ul>{programados.map((m) => fila(m, `${m.categoria}. Se descuenta solo el ${fechaCorta(m.fecha)}.`))}</ul>
          </section>
        )}
        {lista && dias.size === 0 && programados.length === 0 && (
          <div className="vacio">
            <ArrowLeftRight size={32} strokeWidth={1.5} aria-hidden="true" />
            <p>{filtrando ? 'No hay movimientos con este filtro.' : 'Todavía no registraste nada. Tu primer movimiento empieza a armar tu caja.'}</p>
            {filtrando && (
              <button
                className="boton boton--secundario"
                onClick={() => {
                  setRango('todo');
                  setTipo('todos');
                }}
              >
                Ver todos
              </button>
            )}
          </div>
        )}
        {[...dias].map(([dia, items]) => (
          <section key={dia} className="dia">
            <h2>{nombreDelDia(dia, hoy)}</h2>
            <ul>{items.map((m) => fila(m, m.categoria))}</ul>
          </section>
        ))}

        {eliminados.length > 0 && (
          <details className="card historial">
            <summary>
              <History size={18} aria-hidden="true" /> Eliminados ({eliminados.length})
            </summary>
            <p className="contador">Lo que borraste queda guardado acá. Si lo restaurás, vuelve a contar en tu saldo.</p>
            <ul>
              {eliminados.map((e) => (
                <li key={e.id} className="movimiento movimiento--eliminado">
                  <div>
                    <strong>{e.concepto}</strong>
                    <small>
                      {e.categoria}. Del {fechaCorta(e.fecha)}, borrado el {fechaCorta(e.eliminado)}.{e.deAgenda && ' Era un pago agendado.'}
                    </small>
                  </div>
                  <span className={e.tipo === 'ingreso' ? 'monto monto--ingreso' : 'monto'}>
                    {e.tipo === 'ingreso' ? '+' : '−'}
                    {formatoPesos(e.monto)}
                  </span>
                  <button className="boton-texto" onClick={() => restaurar(e)}>
                    <RotateCcw size={16} aria-hidden="true" /> Restaurar
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
