import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CalendarClock, Lock, ShieldCheck, TrendingDown, Wallet } from 'lucide-react';
import { ESCENARIOS, fechaCorta, fmt, fmtCompacto, sumarDias, type AccionAlerta, type Alerta, type Escenario, type Nivel } from '../shared/motor';
import { api, type Yo } from './api';
import type { Navegar } from './App';
import { CampoPesos, digitos, EstadoNivel, textoPesos } from './comunes';
import { Grafico } from './Grafico';
import { Historial, TarjetaSalud, useSalud } from './Salud';

export interface Parametros {
  reserva: number;
  margen: number;
  ventaDiaria: number;
  gastoDiario: number;
}

export type RespuestaCaja =
  | { configurada: false }
  | {
      configurada: true;
      diasHistoria: number;
      hoy: string;
      escenario: Escenario;
      parametros: Parametros;
      saldo: number;
      proyeccion: number[];
      minimo: { v: number; d: number };
      nivel: Nivel;
      razones: string[];
      frase: string;
      pagos7Dias: number;
      cobros7Dias: number;
      cuotaSegura: number;
      alertas: Alerta[] | null;
    };

interface Props {
  yo: Yo;
  espacioId: string;
  /** Cambia cada vez que se registran datos: la pantalla se recarga sola. */
  version: number;
  navegar: Navegar;
  alCambiarDatos: () => Promise<void>;
}

export const NOMBRE_ALERTA: Record<Alerta['nivel'], string> = {
  rojo: 'Urgente',
  amarillo: 'Atención',
  info: 'Próximo',
  verde: 'Buena noticia',
  gris: 'Falta información',
};

/** Ejecuta la acción de un aviso. Devuelve true si cambió datos y hay que recargar. */
export async function ejecutarAccion(espacioId: string, accion: AccionAlerta, navegar: Navegar): Promise<boolean> {
  if (accion.tipo === 'simular') {
    navegar('/simulador');
    return false;
  }
  if (accion.tipo === 'pagar') await api(`/espacios/${espacioId}/compromisos/${accion.compromisoId}/pagar`, { metodo: 'POST' });
  else await api(`/espacios/${espacioId}/compromisos/${accion.compromisoId}/reprogramar`, { metodo: 'POST', cuerpo: { dias: accion.dias } });
  return true;
}

export function Caja({ yo, espacioId, version, navegar, alCambiarDatos }: Props) {
  const [escenario, setEscenario] = useState<Escenario>('base');
  const [caja, setCaja] = useState<RespuestaCaja | null>(null);
  const [error, setError] = useState<string | null>(null);
  const salud = useSalud(espacioId, version);

  const cargar = useCallback(async () => {
    try {
      setCaja(await api<RespuestaCaja>(`/espacios/${espacioId}/caja?escenario=${escenario}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [espacioId, escenario]);

  useEffect(() => {
    void cargar();
  }, [cargar, version]);

  async function ejecutar(accion: AccionAlerta) {
    try {
      if (await ejecutarAccion(espacioId, accion, navegar)) await Promise.all([cargar(), alCambiarDatos()]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const tipo = yo.usuario.tipo;
  const titulo = tipo === 'pyme' ? 'Caja a 30 días' : 'Tu plata a 30 días';
  const conVencimientos = yo.plan.modulos.includes('vencimientos');
  const conEscenarios = yo.plan.modulos.includes('escenarios');

  if (!caja) {
    return (
      <div className="pantalla">
        <h1 className="titulo-pantalla">{titulo}</h1>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <div className="esqueleto" aria-busy="true" />
        )}
      </div>
    );
  }

  if (!caja.configurada) {
    return (
      <div className="pantalla">
        <h1 className="titulo-pantalla">{titulo}</h1>
        <div className="vacio">
          <p>Tu caja se arma sola con lo que registrás. Cargá tus primeros movimientos o importá tu planilla de Excel.</p>
          <button className="boton boton--principal" onClick={() => navegar('/movimientos')}>
            Ir a Movimientos
          </button>
        </div>
        <DatosDeCaja yo={yo} espacioId={espacioId} datos={null} alGuardar={cargar} />
        {salud && <TarjetaSalud salud={salud.salud} />}
        {salud && <Historial historial={salud.historial} />}
      </div>
    );
  }

  const fechaPeor = fechaCorta(sumarDias(caja.hoy, caja.minimo.d));

  return (
    <div className="pantalla">
      <h1 className="titulo-pantalla">{titulo}</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className={`estado estado--${caja.nivel}`}>
        <EstadoNivel nivel={caja.nivel} />
        <p className="estado__frase">{caja.frase}</p>
        <ul className="estado__razones">
          {caja.razones.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>


      {caja.saldo === 0 && (
        <p className="nota">
          Tu saldo sale de tus movimientos. Si ya tenés plata,{' '}
          <a
            href="/movimientos"
            onClick={(e) => {
              e.preventDefault();
              navegar('/movimientos');
            }}
          >
            registrala como un ingreso
          </a>
          .
        </p>
      )}

      <dl className="cifras cifras--cuatro">
        <div>
          <dt>
            <Wallet size={16} aria-hidden="true" /> Disponible hoy
          </dt>
          <dd title={fmt(caja.saldo)}>{fmtCompacto(caja.saldo)}</dd>
        </div>
        <div>
          <dt>
            <CalendarClock size={16} aria-hidden="true" /> Pagos en 7 días
          </dt>
          <dd title={fmt(caja.pagos7Dias)}>{fmtCompacto(caja.pagos7Dias)}</dd>
          {!conVencimientos && <small>Disponible desde el plan Intermedio</small>}
        </div>
        <div>
          <dt>
            <TrendingDown size={16} aria-hidden="true" /> Tu peor día
          </dt>
          <dd title={fmt(caja.minimo.v)}>{fmtCompacto(caja.minimo.v)}</dd>
          <small>{fechaPeor}</small>
        </div>
        <div>
          <dt>
            <ShieldCheck size={16} aria-hidden="true" /> Cuota segura
          </dt>
          <dd title={fmt(caja.cuotaSegura)}>{fmtCompacto(caja.cuotaSegura)}</dd>
          <small>30% de lo que te queda por mes</small>
        </div>
      </dl>

      <section className="bloque">
        <div className="segmentado segmentado--tres" role="group" aria-label="Escenario">
          {(Object.keys(ESCENARIOS) as Escenario[]).map((e) => {
            const bloqueado = e !== 'base' && !conEscenarios;
            return (
              <button key={e} type="button" aria-pressed={escenario === e} disabled={bloqueado} onClick={() => setEscenario(e)}>
                {bloqueado && <Lock size={14} aria-hidden="true" />} {ESCENARIOS[e].nombre}
              </button>
            );
          })}
        </div>
        <p className="contador">{conEscenarios ? ESCENARIOS[escenario].detalle : 'Los escenarios Conservador y Estrés están incluidos en el plan Full.'}</p>
        <Grafico titulo={`${titulo}, escenario ${ESCENARIOS[escenario].nombre}`} hoy={caja.hoy} reserva={caja.parametros.reserva} series={[{ nombre: 'Caja estimada', valores: caja.proyeccion, clase: 'serie-1' }]} />
        <p className="contador">Es una estimación según los datos que cargaste, no una garantía.</p>
      </section>

      {caja.alertas ? (
        <section className="bloque">
          <h2>Avisos</h2>
          {caja.alertas.length === 0 ? (
            <p className="contador">Por ahora no hay nada que te tenga que preocupar.</p>
          ) : (
            <ul className="alertas">
              {caja.alertas.map((a) => (
                <li key={a.id} className={`alerta alerta--${a.nivel}`}>
                  <small>{NOMBRE_ALERTA[a.nivel]}</small>
                  <strong>{a.titulo}</strong>
                  <p>{a.detalle}</p>
                  {a.acciones.length > 0 && (
                    <div className="alerta__acciones">
                      {a.acciones.map((accion) => (
                        <button key={accion.texto} className="boton boton--chico" onClick={() => ejecutar(accion)}>
                          {accion.texto}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <p className="contador">
          <Lock size={14} aria-hidden="true" /> Los avisos antes de que falte plata están incluidos desde el plan Intermedio.
        </p>
      )}

      <DatosDeCaja yo={yo} espacioId={espacioId} datos={{ ...caja.parametros, diasHistoria: caja.diasHistoria }} alGuardar={cargar} />

      {salud && <TarjetaSalud salud={salud.salud} />}
      {salud && <Historial historial={salud.historial} />}

    </div>
  );
}

/**
 * Lo que entra y lo que sale se calculan con los movimientos y no se pueden editar.
 * La reserva es lo único que define la persona.
 */
function DatosDeCaja({
  yo,
  espacioId,
  datos,
  alGuardar,
}: {
  yo: Yo;
  espacioId: string;
  datos: (Parametros & { diasHistoria: number }) | null;
  alGuardar: () => Promise<void>;
}) {
  const esPyme = yo.usuario.tipo === 'pyme';
  // Una persona piensa su plata por mes y un negocio sus ventas por día. El motor siempre calcula por día.
  const escala = esPyme ? 1 : 30;
  const [reserva, setReserva] = useState(datos && datos.reserva > 0 ? textoPesos(datos.reserva) : '');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    setEnviando(true);
    try {
      await api(`/espacios/${espacioId}/parametros`, { metodo: 'PUT', cuerpo: { reserva: digitos(reserva) } });
      setAviso('Reserva guardada.');
      await alGuardar();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const bloqueado = (etiqueta: string, valor: number | null) => (
    <label className="campo campo--bloqueado">
      <span>
        {etiqueta} <Lock size={13} aria-label="Se calcula solo" />
      </span>
      <input readOnly aria-readonly="true" tabIndex={-1} value={valor === null ? 'Sin movimientos todavía' : textoPesos(valor)} />
    </label>
  );

  return (
    <form className="registro datos-caja" onSubmit={guardar}>
      <h2>Datos de tu caja</h2>
      {bloqueado(esPyme ? 'Lo que entra por día' : 'Lo que te entra por mes', datos ? datos.ventaDiaria * escala : null)}
      {bloqueado(esPyme ? 'Lo que gastás por día' : 'Lo que gastás por mes', datos ? datos.gastoDiario * escala : null)}
      <p className="contador">
        {datos
          ? `Se calculan solos con tus movimientos de los últimos ${datos.diasHistoria} ${datos.diasHistoria === 1 ? 'día' : 'días'}${datos.diasHistoria < 30 ? ': con pocos días el promedio todavía puede cambiar bastante' : ''}.`
          : 'Se van a calcular solos cuando registres movimientos.'}
        {yo.plan.modulos.includes('vencimientos') && ' Los pagos que marcás en Pagos y cobros futuros no se suman acá, porque ya están agendados.'}
      </p>
      <CampoPesos
        etiqueta="Lo que querés reservar"
        valor={reserva}
        alCambiar={setReserva}
        ayuda="La plata que no querés tocar. Te avisamos si tu caja va a bajar de este monto."
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="aviso" role="status">
        {aviso}
      </p>
      <button className="boton boton--principal boton--inicio" disabled={enviando}>
        {enviando ? 'Guardando…' : 'Guardar la reserva'}
      </button>
    </form>
  );
}
