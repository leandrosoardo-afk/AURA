import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeftRight,
  CalendarClock,
  Calculator,
  Check,
  ChevronRight,
  CircleHelp,
  HandCoins,
  House,
  Landmark,
  Lock,
  LogOut,
  MoreHorizontal,
  OctagonAlert,
  Plus,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Settings,
  Sparkles,
  Wallet,
  CalendarDays,
  FileText,
} from 'lucide-react';
import { nombreModulo, type ModuloId } from '../shared/adaptacion';
import { fechaCorta, fmt, fmtCompacto, sumarDias, type Nivel } from '../shared/motor';
import { api, ErrorApi, fechaDeHoy, type Movimiento, type Plan, type Resumen, type Yo } from './api';
import type { Navegar } from './App';
import { Ayuda } from './Ayuda';
import { Avatar, Configuracion } from './Configuracion';
import { Caja, ejecutarAccion, NOMBRE_ALERTA, type RespuestaCaja } from './Caja';
import { Bloqueo } from './comunes';
import { GraficoMes } from './GraficoMes';
import { Importar } from './Importar';
import { Informes } from './Informes';
import { Mercado } from './Mercado';
import { Movimientos } from './Movimientos';
import { FormularioMovimiento, Hoja } from './RegistroRapido';
import { TarjetaSalud, useSalud } from './Salud';
import { Simulador } from './Simulador';
import { FormularioCompromiso, Vencimientos } from './Vencimientos';

interface Props {
  yo: Yo;
  ruta: string;
  /** La parte "?…" de la dirección, con filtros. */
  consulta: string;
  navegar: Navegar;
  alSalir: () => void;
  /** Vuelve a pedir los datos del usuario, por ejemplo después de editar el perfil. */
  alActualizar: () => Promise<void>;
}

// Las secciones que ya funcionan. El orden sale del perfil de cada usuario.
const RUTA_DE_MODULO: Partial<Record<ModuloId, string>> = {
  caja: '/caja',
  vencimientos: '/vencimientos',
  simulador: '/simulador',
  alertas: '/caja',
  escenarios: '/caja',
  informes: '/informes',
};

interface Seccion {
  ruta: string;
  nombre: string;
  /** Para la barra inferior del celular, donde no entra un nombre largo. */
  corto?: string;
  detalle: string;
  Icono: typeof House;
  modulo: string | null;
}

function seccionesDe(yo: Yo): Seccion[] {
  const persona = yo.usuario.tipo === 'persona';
  const modulo: Record<string, Seccion> = {
    caja: { ruta: '/caja', nombre: persona ? 'Tu plata' : 'Caja', detalle: 'Próximos 30 días', Icono: TrendingUp, modulo: 'caja' },
    vencimientos: { ruta: '/vencimientos', nombre: 'Pagos y cobros futuros', corto: 'Futuros', detalle: 'Lo que vas a pagar y cobrar', Icono: CalendarClock, modulo: 'vencimientos' },
    simulador: { ruta: '/simulador', nombre: 'Simulador', detalle: 'Compras en cuotas', Icono: Calculator, modulo: 'simulador' },
    informes: { ruta: '/informes', nombre: 'Informes', detalle: 'En PDF o Excel', Icono: FileText, modulo: 'informes' },
  };
  return [
    { ruta: '/', nombre: 'Inicio', detalle: 'Resumen', Icono: House, modulo: null },
    { ruta: '/movimientos', nombre: 'Movimientos', detalle: 'Ingresos y gastos', Icono: ArrowLeftRight, modulo: null },
    ...yo.adaptacion.modulos.flatMap((m) => (modulo[m] ? [modulo[m]] : [])),
    { ruta: '/mercado', nombre: 'Mercado', detalle: 'Dólar, créditos e inversiones', Icono: Landmark, modulo: null },
  ];
}

const CLAVE_TEMA = 'cajaclara.tema';

// La interfaz se diseñó para este ancho. En una computadora con la ventana más angosta se muestra
// igual, a escala, en vez de reacomodarse. En el celular (menos de 768 px) usa su propio diseño.
const ANCHO_DISENO = 1280;
const ANCHO_CELULAR = 768;

function leerTema(): 'light' | 'dark' | null {
  try {
    const t = localStorage.getItem(CLAVE_TEMA);
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

/** Arriba a la derecha: el + (cambia según la pantalla), simular préstamo y la foto de perfil. */
function AccionesSuperiores({
  mas,
  simulador,
  perfil,
  alIrAConfiguracion,
}: {
  mas: { etiqueta: string; alTocar: () => void };
  simulador: { incluido: boolean; alTocar: () => void };
  perfil: Yo['perfil'];
  alIrAConfiguracion: (e: { preventDefault: () => void }) => void;
}) {
  return (
    <div className="acciones-superiores">
      <button type="button" className="accion-redonda accion-redonda--principal" aria-label={mas.etiqueta} data-tooltip={mas.etiqueta} onClick={mas.alTocar}>
        <Plus size={22} strokeWidth={2.4} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`accion-redonda${simulador.incluido ? '' : ' accion-redonda--bloqueada'}`}
        aria-label={simulador.incluido ? 'Simular préstamo' : 'Simular préstamo (no incluido en tu plan)'}
        data-tooltip={simulador.incluido ? 'Simular préstamo' : 'Simular préstamo · Mejorá tu plan'}
        onClick={simulador.alTocar}
      >
        <HandCoins size={20} aria-hidden="true" />
        {!simulador.incluido && <Lock className="accion-redonda__candado" size={11} aria-hidden="true" />}
      </button>
      <a href="/configuracion" className="acciones-superiores__perfil" onClick={alIrAConfiguracion} aria-label="Ir a Configuración" data-tooltip="Tu perfil y configuración">
        <Avatar perfil={perfil} />
      </a>
    </div>
  );
}

export function Espacio({ yo, ruta, consulta, navegar, alSalir, alActualizar }: Props) {
  const espacio = yo.espacios[0];
  const [datos, setDatos] = useState<{ movimientos: Movimiento[]; resumen: Resumen } | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [masAbierto, setMasAbierto] = useState(false);
  const [registroAbierto, setRegistroAbierto] = useState(false);
  const [importarAbierto, setImportarAbierto] = useState(false);
  const [ayudaAbierta, setAyudaAbierta] = useState(false);
  const [agendarAbierto, setAgendarAbierto] = useState(false);
  /** La función bloqueada que la persona quiso usar: se le explica qué plan la incluye. */
  const [mejorar, setMejorar] = useState<{ nombre: string; modulo: string } | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; deshacer?: () => Promise<void> } | null>(null);
  const [tema, setTema] = useState<'light' | 'dark' | null>(leerTema);

  useEffect(() => {
    setMasAbierto(false);
  }, [ruta]);

  useEffect(() => {
    const raiz = document.documentElement;
    const ajustar = () => {
      // Se mide sin zoom y sin la barra de desplazamiento, que si no taparía el borde derecho.
      raiz.style.zoom = '';
      const ancho = raiz.clientWidth;
      const escalar = window.innerWidth >= ANCHO_CELULAR && ancho < ANCHO_DISENO;
      raiz.classList.toggle('escalada', escalar);
      raiz.style.zoom = escalar ? String(ancho / ANCHO_DISENO) : '';
      raiz.style.setProperty('--escala', escalar ? String(ancho / ANCHO_DISENO) : '1');
    };
    ajustar();
    window.addEventListener('resize', ajustar);
    return () => {
      window.removeEventListener('resize', ajustar);
      raiz.classList.remove('escalada');
      raiz.style.zoom = '';
      raiz.style.removeProperty('--escala');
    };
  }, []);

  useEffect(() => {
    if (tema) document.documentElement.dataset.theme = tema;
    else delete document.documentElement.dataset.theme;
  }, [tema]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 5000);
    return () => clearTimeout(t);
  }, [aviso]);

  useEffect(() => {
    api<{ planes: Plan[] }>('/planes')
      .then((r) => setPlanes(r.planes))
      .catch(() => setPlanes([]));
  }, []);

  const cargar = useCallback(async () => {
    try {
      setDatos(await api(`/espacios/${espacio.id}/movimientos`));
      setVersion((v) => v + 1);
      setError(null);
    } catch (err) {
      if (err instanceof ErrorApi && err.status === 401) alSalir();
      else setError((err as Error).message);
    }
  }, [espacio.id, alSalir]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Los datos se recargan solos: al volver a la ventana y cada minuto mientras está a la vista.
  // Así lo cargado en otra pestaña aparece, y un gasto programado se descuenta el día que llega.
  useEffect(() => {
    const siVisible = () => {
      if (document.visibilityState === 'visible') void cargar();
    };
    const intervalo = window.setInterval(siVisible, 60_000);
    document.addEventListener('visibilitychange', siVisible);
    window.addEventListener('focus', siVisible);
    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener('visibilitychange', siVisible);
      window.removeEventListener('focus', siVisible);
    };
  }, [cargar]);

  /** null es "automático": sigue lo que tenga elegido la compu o el celular. */
  function elegirTema(nuevo: 'light' | 'dark' | null) {
    setTema(nuevo);
    try {
      if (nuevo) localStorage.setItem(CLAVE_TEMA, nuevo);
      else localStorage.removeItem(CLAVE_TEMA);
    } catch {
      // Sin almacenamiento el cambio dura hasta recargar.
    }
  }

  async function salir() {
    await api('/auth/salir', { metodo: 'POST' });
    alSalir();
  }

  async function alRegistrar({ id, tipo, fecha }: { id: string; tipo: 'ingreso' | 'egreso'; fecha: string }) {
    setRegistroAbierto(false);
    await cargar();
    setAviso({
      texto: fecha > fechaDeHoy() ? `${tipo === 'ingreso' ? 'Ingreso' : 'Gasto'} programado para el ${fechaCorta(fecha)}` : tipo === 'ingreso' ? 'Ingreso registrado' : 'Gasto registrado',
      deshacer: async () => {
        await api(`/espacios/${espacio.id}/movimientos/${id}`, { metodo: 'DELETE' });
        setAviso(null);
        await cargar();
      },
    });
  }

  const secciones = seccionesDe(yo);
  const bloqueada = (s: Seccion) => s.modulo !== null && !yo.plan.modulos.includes(s.modulo);
  const planDe = (modulo: string) => planes.find((p) => p.modulos.includes(modulo))?.nombre ?? 'Intermedio';
  const ir = (destino: string) => (e: { preventDefault: () => void }) => {
    e.preventDefault();
    navegar(destino);
  };
  const conModulo = (modulo: string) => yo.plan.modulos.includes(modulo);
  // El + hace lo que corresponde a la pantalla: en Pagos y cobros futuros agenda; en el resto, registra.
  const enFuturos = ruta === '/vencimientos' && conModulo('vencimientos');
  const mas = enFuturos
    ? { etiqueta: 'Agendar un pago o cobro futuro', alTocar: () => setAgendarAbierto(true) }
    : { etiqueta: 'Registrar un ingreso o un gasto', alTocar: () => setRegistroAbierto(true) };
  const simulador = {
    incluido: conModulo('simulador'),
    alTocar: () => (conModulo('simulador') ? navegar('/simulador') : setMejorar({ nombre: 'el Simulador de préstamos y cuotas', modulo: 'simulador' })),
  };
  // Lo que el plan no incluye se ve, pero en gris: al tocarlo se explica cómo habilitarlo.
  const irOMejorar = (s: Seccion) => (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setMasAbierto(false);
    if (bloqueada(s)) setMejorar({ nombre: s.nombre, modulo: s.modulo! });
    else navegar(s.ruta);
  };

  // En el celular: Inicio, Movimientos, el +, lo primero según el perfil, y el resto en "Más".
  const pestanaPerfil = secciones[2];
  const configuracion: Seccion = { ruta: '/configuracion', nombre: 'Configuración', detalle: 'Tu perfil, la apariencia y tu plan', Icono: Settings, modulo: null };
  const enMas = [...secciones.filter((s) => s !== secciones[0] && s !== secciones[1] && s !== pestanaPerfil), configuracion];

  return (
    <div className="app-container">
      <aside className="sidebar">
        <a className="logo-box logo-box--animado" href="/" onClick={ir('/')} aria-label="AURA, ir al inicio">
          {/* El logo animado del grupo, en loop. Es un video chico (46 KB) en vez del GIF original de 13 MB. */}
          <video className="logo-animado" autoPlay loop muted playsInline poster="/logo-aura-completo.png" width={220} height={100} aria-hidden="true">
            <source src="/logo-aura-animado.webm" type="video/webm" />
            <source src="/logo-aura-animado.mp4" type="video/mp4" />
          </video>
        </a>
        <p className="sidebar-espacio">{espacio.nombre}</p>
        <nav className="nav-menu" aria-label="Secciones">
          {[...secciones, configuracion].map((s) => (
            <a
              key={s.ruta}
              href={s.ruta}
              className={`nav-link${ruta === s.ruta ? ' active' : ''}${bloqueada(s) ? ' nav-link--bloqueado' : ''}`}
              aria-current={ruta === s.ruta ? 'page' : undefined}
              onClick={irOMejorar(s)}
              title={bloqueada(s) ? `${s.nombre}: incluido desde el plan ${planDe(s.modulo!)}` : s.nombre}
            >
              <s.Icono size={20} strokeWidth={1.75} aria-hidden="true" />
              <span className="nav-label">{s.nombre}</span>
              {bloqueada(s) && <Lock className="candado nav-label" size={14} aria-label={`Incluido desde el plan ${planDe(s.modulo!)}`} />}
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="theme-btn" onClick={salir} title="Cerrar sesión">
            <LogOut size={18} aria-hidden="true" />
            <span className="nav-label">Cerrar sesión</span>
          </button>
        </div>
      </aside>

      <div className="main-wrapper">
        <header className="mobile-header">
          <a className="mobile-ident" href="/configuracion" onClick={ir('/configuracion')} aria-label="Ir a Configuración">
            <Avatar perfil={yo.perfil} />
            <span>
              <span className="mobile-greeting">Hola, {yo.perfil.nombre}</span>
              <span className="mobile-sub">{espacio.nombre}</span>
            </span>
          </a>
        </header>

        <main className="content-area">
          {ruta !== '/' && (
            <div className="barra-superior">
              <AccionesSuperiores mas={mas} simulador={simulador} perfil={yo.perfil} alIrAConfiguracion={ir('/configuracion')} />
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {ruta === '/movimientos' ? (
            <Movimientos key={consulta} yo={yo} espacioId={espacio.id} consulta={consulta} version={version} resumen={datos?.resumen ?? null} recargar={cargar} alRegistrar={alRegistrar} />
          ) : ruta === '/caja' ? (
            <Caja yo={yo} espacioId={espacio.id} version={version} navegar={navegar} alCambiarDatos={cargar} />
          ) : ruta === '/vencimientos' ? (
            yo.plan.modulos.includes('vencimientos') ? (
              <Vencimientos key={consulta} yo={yo} espacioId={espacio.id} consulta={consulta} version={version} alCambiarDatos={cargar} />
            ) : (
              <Bloqueo titulo="Pagos y cobros futuros" descripcion="Agendá pagos y cobros, y mirá cómo cambian tu caja antes de que lleguen." plan={planDe('vencimientos')} />
            )
          ) : ruta === '/simulador' ? (
            yo.plan.modulos.includes('simulador') ? (
              <Simulador espacioId={espacio.id} navegar={navegar} />
            ) : (
              <Bloqueo titulo="Simulador" descripcion="Probá una compra en cuotas o un crédito y mirá cómo queda tu caja antes de decidir." plan={planDe('simulador')} />
            )
          ) : ruta === '/informes' ? (
            yo.plan.modulos.includes('informes') ? (
              <Informes yo={yo} espacioId={espacio.id} />
            ) : (
              <Bloqueo titulo="Informes" descripcion="Descargá en PDF o Excel tus movimientos, tu plata a 30 días y los pagos y cobros futuros, para vos o tu contador." plan={planDe('informes')} />
            )
          ) : ruta === '/mercado' ? (
            <Mercado yo={yo} />
          ) : ruta === '/configuracion' || ruta === '/perfil' ? (
            <Configuracion yo={yo} tema={tema} alElegirTema={elegirTema} alActualizar={alActualizar} alSalir={salir} />
          ) : (
            <Inicio
              yo={yo}
              espacioId={espacio.id}
              resumen={datos?.resumen ?? null}
              version={version}
              planes={planes}
              navegar={navegar}
              alCambiarDatos={cargar}
              alRegistrar={() => setRegistroAbierto(true)}
              alMejorar={(nombre, modulo) => setMejorar({ nombre, modulo })}
              acciones={<AccionesSuperiores mas={mas} simulador={simulador} perfil={yo.perfil} alIrAConfiguracion={ir('/configuracion')} />}
            />
          )}
        </main>
      </div>

      <nav className="mobile-bottom-nav" aria-label="Secciones">
        {[secciones[0], secciones[1]].map((s) => (
          <a key={s.ruta} href={s.ruta} className={`bottom-tab${ruta === s.ruta ? ' active' : ''}`} aria-current={ruta === s.ruta ? 'page' : undefined} onClick={ir(s.ruta)}>
            <s.Icono size={22} strokeWidth={1.75} aria-hidden="true" />
            {s.nombre}
          </a>
        ))}
        <button className="bottom-plus-btn" aria-label={mas.etiqueta} onClick={mas.alTocar}>
          <Plus size={28} aria-hidden="true" />
        </button>
        <a
          href={pestanaPerfil.ruta}
          className={`bottom-tab${ruta === pestanaPerfil.ruta ? ' active' : ''}${bloqueada(pestanaPerfil) ? ' bottom-tab--bloqueado' : ''}`}
          aria-current={ruta === pestanaPerfil.ruta ? 'page' : undefined}
          onClick={irOMejorar(pestanaPerfil)}
        >
          <pestanaPerfil.Icono size={22} strokeWidth={1.75} aria-hidden="true" />
          <span aria-hidden={pestanaPerfil.corto ? true : undefined}>{pestanaPerfil.corto ?? pestanaPerfil.nombre}</span>
          {pestanaPerfil.corto && <span className="visualmente-oculto">{pestanaPerfil.nombre}</span>}
        </a>
        <button className={`bottom-tab${enMas.some((s) => s.ruta === ruta) ? ' active' : ''}`} aria-haspopup="dialog" onClick={() => setMasAbierto(true)}>
          <MoreHorizontal size={22} strokeWidth={1.75} aria-hidden="true" />
          Más
        </button>
      </nav>

      <Hoja titulo="Más secciones" abierta={masAbierto} alCerrar={() => setMasAbierto(false)}>
        <div className="sheet-mas-grid">
          {enMas.map((s) => (
            <a key={s.ruta} href={s.ruta} className={`sheet-mas-item${bloqueada(s) ? ' sheet-mas-item--bloqueado' : ''}`} onClick={irOMejorar(s)}>
              <span className="sheet-mas-icon">
                <s.Icono size={22} aria-hidden="true" />
              </span>
              <b>{s.nombre}</b>
              <small>{bloqueada(s) ? `Desde el plan ${planDe(s.modulo!)}` : s.detalle}</small>
            </a>
          ))}
          <button className="sheet-mas-item" onClick={salir}>
            <span className="sheet-mas-icon sheet-mas-icon--salir">
              <LogOut size={22} aria-hidden="true" />
            </span>
            <b>Cerrar sesión</b>
            <small>Salir de tu cuenta</small>
          </button>
        </div>
      </Hoja>

      <Hoja titulo="Registrar un movimiento" abierta={registroAbierto} alCerrar={() => setRegistroAbierto(false)}>
        <FormularioMovimiento
          yo={yo}
          espacioId={espacio.id}
          resumen={datos?.resumen ?? null}
          alRegistrar={alRegistrar}
          alImportar={() => {
            setRegistroAbierto(false);
            setImportarAbierto(true);
          }}
          enfocar
        />
      </Hoja>

      <Hoja titulo="Agendar un pago o cobro futuro" abierta={agendarAbierto} alCerrar={() => setAgendarAbierto(false)}>
        <FormularioCompromiso
          yo={yo}
          espacioId={espacio.id}
          enfocar
          alAgendar={async (tipo) => {
            setAgendarAbierto(false);
            setAviso({ texto: tipo === 'pago' ? 'Pago agendado' : 'Cobro agendado' });
            await cargar();
          }}
        />
      </Hoja>

      <Hoja titulo="Función de otro plan" abierta={mejorar !== null} alCerrar={() => setMejorar(null)}>
        {mejorar && (
          <div className="mejorar-plan">
            <span className="mejorar-plan__icono">
              <Sparkles size={26} aria-hidden="true" />
            </span>
            <p>
              <strong>{mejorar.nombre}</strong> no está incluido en tu plan {yo.plan.nombre}. Para usarlo tenés que mejorar tu plan al <strong>{planDe(mejorar.modulo)}</strong>.
            </p>
            <p className="contador">Podés cambiar de plan cuando quieras desde Configuración. Por ahora no se cobra nada.</p>
            <div className="mejorar-plan__botones">
              <button
                className="boton boton--principal"
                onClick={() => {
                  setMejorar(null);
                  navegar('/configuracion');
                }}
              >
                Ver planes
              </button>
              <button className="boton-texto" onClick={() => setMejorar(null)}>
                Ahora no
              </button>
            </div>
          </div>
        )}
      </Hoja>

      <Hoja titulo="Importar desde Excel" abierta={importarAbierto} alCerrar={() => setImportarAbierto(false)}>
        <Importar espacioId={espacio.id} alCambiarDatos={cargar} alCerrar={() => setImportarAbierto(false)} />
      </Hoja>

      <Ayuda yo={yo} planes={planes} navegar={navegar} abierto={ayudaAbierta} alCerrar={() => setAyudaAbierta(false)} />
      {/* El asistente vive en la esquina inferior derecha: tocándolo se abre la ventanita del chat. */}
      <button
        className={`asistente-boton${ayudaAbierta ? ' asistente-boton--abierto' : ''}`}
        aria-label={ayudaAbierta ? 'Cerrar el asistente' : 'Abrir el asistente de AURA'}
        aria-expanded={ayudaAbierta}
        title="Asistente de AURA"
        onClick={() => setAyudaAbierta((a) => !a)}
      >
        <img src="/asistente-aura.gif" alt="" width={72} height={72} />
      </button>

      <div className="toast-zona" role="status" aria-live="polite">
        {aviso && (
          <div className="toast">
            <Check size={18} aria-hidden="true" />
            {aviso.texto}
            {aviso.deshacer && (
              <button className="toast__accion" onClick={aviso.deshacer}>
                Deshacer
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Publicidad() {
  return (
    <aside className="publicidad" aria-label="Publicidad">
      <span className="publicidad__rotulo">Publicidad</span>
      <p>Anuncio de ejemplo. Acá se muestra la publicidad del plan Gratis.</p>
    </aside>
  );
}

const HERO: Record<Nivel, { etiqueta: string; Icono: typeof ShieldCheck }> = {
  verde: { etiqueta: 'Caja sana', Icono: ShieldCheck },
  amarillo: { etiqueta: 'Precaución', Icono: TriangleAlert },
  rojo: { etiqueta: 'Riesgo de liquidez', Icono: OctagonAlert },
  gris: { etiqueta: 'Información inicial', Icono: CircleHelp },
};

function Kpi({
  Icono,
  etiqueta,
  valor,
  completo,
  detalle,
  alerta = false,
  destino,
  navegar,
}: {
  Icono: typeof Wallet;
  etiqueta: string;
  valor: string;
  completo?: string;
  detalle?: string;
  alerta?: boolean;
  /** Adónde lleva el clic: los movimientos que explican este número. */
  destino: string;
  navegar: Navegar;
}) {
  return (
    <a
      className="card kpi kpi--enlace"
      href={destino}
      title={completo}
      aria-label={`${etiqueta}: ${completo ?? valor}. Ver el detalle`}
      onClick={(e) => {
        e.preventDefault();
        navegar(destino);
      }}
    >
      <span className={`kpi__icono${alerta ? ' kpi__icono--alerta' : ''}`}>
        <Icono size={18} aria-hidden="true" />
      </span>
      <ChevronRight className="kpi__ir" size={18} aria-hidden="true" />
      <span className="kpi__etiqueta">{etiqueta}</span>
      <b className="kpi__valor">{valor}</b>
      {detalle && <em className={`kpi__detalle${alerta ? ' kpi__detalle--alerta' : ''}`}>{detalle}</em>}
    </a>
  );
}

function Inicio({
  yo,
  espacioId,
  resumen,
  version,
  planes,
  navegar,
  alCambiarDatos,
  alRegistrar,
  alMejorar,
  acciones,
}: {
  yo: Yo;
  espacioId: string;
  resumen: Resumen | null;
  version: number;
  planes: Plan[];
  navegar: Navegar;
  alCambiarDatos: () => Promise<void>;
  alRegistrar: () => void;
  alMejorar: (nombre: string, modulo: string) => void;
  acciones: ReactNode;
}) {
  const { adaptacion: a, usuario, perfil, plan } = yo;
  const [caja, setCaja] = useState<RespuestaCaja | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const salud = useSalud(espacioId, version);

  useEffect(() => {
    api<RespuestaCaja>(`/espacios/${espacioId}/caja`)
      .then(setCaja)
      .catch(() => setCaja(null));
  }, [espacioId, version]);

  const irA = (destino: string) => (e: { preventDefault: () => void }) => {
    e.preventDefault();
    navegar(destino);
  };

  // El acceso destacado es el módulo que más le sirve a este perfil y que su plan incluye.
  const prioritario = a.modulos.find((m) => RUTA_DE_MODULO[m] && plan.modulos.includes(m));
  // Adónde lleva cada tarjeta. Sin la sección de futuros (plan Gratis), los programados están en Movimientos.
  const hoyIso = fechaDeHoy();
  const conFuturos = plan.modulos.includes('vencimientos');
  const semanaQueViene = (tipo: 'ingreso' | 'egreso') =>
    conFuturos ? `/vencimientos?tipo=${tipo === 'egreso' ? 'pago' : 'cobro'}&dias=7` : `/movimientos?tipo=${tipo}&desde=${sumarDias(hoyIso, 1)}&hasta=${sumarDias(hoyIso, 7)}`;
  const destinos = {
    disponible: '/movimientos?hasta=' + hoyIso,
    pagos: semanaQueViene('egreso'),
    cobros: semanaQueViene('ingreso'),
    cuota: plan.modulos.includes('simulador') ? '/simulador' : '/caja',
  };
  const configurada = caja?.configurada ? caja : null;
  const nivel: Nivel = configurada?.nivel ?? 'gris';
  const hero = HERO[nivel];
  const hoy = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="pantalla pantalla--inicio">
      <header className="desktop-header">
        <div>
          <h1 className="saludo-grande">Hola, {perfil.nombre} 👋</h1>
          <p className="saludo-sub">
            {yo.espacios[0].nombre} · {hoy}
          </p>
        </div>
        {acciones}
      </header>

      <section className={`hero-card hero-card--${nivel}`} aria-label="¿Te alcanza?">
        <span className="hero-badge">
          <hero.Icono size={32} strokeWidth={2.2} aria-hidden="true" />
        </span>
        <div className="hero-texto">
          <small className="hero-etiqueta">{hero.etiqueta}</small>
          <p className="hero-pregunta">{a.preguntaFoco}</p>
          <h2 className="hero-frase">{configurada ? configurada.frase : caja ? 'Registrá tus movimientos para que te respondamos.' : '…'}</h2>
          <p className="hero-detalle">
            {configurada
              ? // La causa del bache, si hay aviso: la frase de arriba ya dice qué pasa y cuándo.
                (configurada.alertas?.find((al) => al.id.startsWith('bache-'))?.detalle ?? configurada.razones[0])
              : 'Cargá lo que entra y lo que sale, o importá tu planilla de Excel: la caja se arma sola con eso.'}
          </p>
        </div>
        {caja && (
          <div className="hero-cta">
            {!configurada ? (
              <button className="boton boton--principal" onClick={alRegistrar}>
                Registrar un movimiento
              </button>
            ) : nivel === 'amarillo' || nivel === 'rojo' ? (
              <button className="boton boton--principal" onClick={() => navegar('/caja')}>
                Ver cómo resolverlo
              </button>
            ) : nivel === 'gris' ? (
              <button className="boton boton--principal" onClick={alRegistrar}>
                Registrar un movimiento
              </button>
            ) : (
              prioritario && (
                <button className="boton boton--principal" onClick={() => navegar(RUTA_DE_MODULO[prioritario]!)}>
                  {nombreModulo(prioritario, usuario.tipo)}
                </button>
              )
            )}
          </div>
        )}
      </section>

      <div className="kpi-grid">
        {configurada ? (
          <>
            <Kpi Icono={Wallet} etiqueta="Disponible hoy" destino={destinos.disponible} navegar={navegar} valor={fmtCompacto(configurada.saldo)} completo={fmt(configurada.saldo)} detalle={a.etiquetaSaldo} />
            <Kpi
              Icono={CalendarDays}
              etiqueta="Pagos de esta semana" destino={destinos.pagos} navegar={navegar}
              valor={fmtCompacto(configurada.pagos7Dias)}
              completo={fmt(configurada.pagos7Dias)}
              detalle={plan.modulos.includes('vencimientos') ? 'Agendados y programados con fecha' : 'Gastos programados con fecha'}
            />
            <Kpi
              Icono={HandCoins}
              etiqueta="Cobros de esta semana" destino={destinos.cobros} navegar={navegar}
              valor={fmtCompacto(configurada.cobros7Dias)}
              completo={fmt(configurada.cobros7Dias)}
              detalle={plan.modulos.includes('vencimientos') ? 'Agendados y programados con fecha' : 'Ingresos programados con fecha'}
            />
            <Kpi Icono={ShieldCheck} etiqueta="Cuota segura máxima" destino={destinos.cuota} navegar={navegar} valor={fmtCompacto(configurada.cuotaSegura)} completo={fmt(configurada.cuotaSegura)} detalle="30% de lo que te queda por mes" />
          </>
        ) : (
          resumen && (
            <>
              <Kpi Icono={Wallet} etiqueta="Disponible hoy" destino={destinos.disponible} navegar={navegar} valor={fmtCompacto(resumen.saldo)} completo={fmt(resumen.saldo)} detalle={a.etiquetaSaldo} />
              <Kpi Icono={TrendingUp} etiqueta="Entró este mes" destino={'/movimientos?tipo=ingreso&rango=mes'} navegar={navegar} valor={fmtCompacto(resumen.ingresosMes)} completo={fmt(resumen.ingresosMes)} />
              <Kpi Icono={TrendingDown} etiqueta="Salió este mes" destino={'/movimientos?tipo=egreso&rango=mes'} navegar={navegar} valor={fmtCompacto(resumen.egresosMes)} completo={fmt(resumen.egresosMes)} />
              <Kpi
                Icono={ArrowLeftRight}
                etiqueta="Registros del mes" destino={'/movimientos?rango=mes'} navegar={navegar}
                valor={String(resumen.registrosMes)}
                detalle={resumen.limiteRegistrosMes !== null ? `de ${resumen.limiteRegistrosMes} en tu plan` : 'Sin límite en tu plan'}
              />
            </>
          )
        )}
      </div>

      {resumen && <GraficoMes resumen={resumen} />}

      {plan.incluye_publicidad && <Publicidad />}

      <section className="card panel panel--alertas">
        <div className="panel__cabecera">
          <h2>Para tener en cuenta</h2>
          {configurada?.alertas && (
            <small className="contador">
              {configurada.alertas.length} {configurada.alertas.length === 1 ? 'alerta' : 'alertas'}
            </small>
          )}
        </div>
        {errorAccion && (
          <p className="error" role="alert">
            {errorAccion}
          </p>
        )}
        {configurada?.alertas ? (
          configurada.alertas.length === 0 ? (
            <p className="contador">Por ahora no hay nada que te tenga que preocupar.</p>
          ) : (
            <ul className="alertas-lista">
              {configurada.alertas.map((al) => (
                <li key={al.id} className={`alerta-item alerta-item--${al.nivel}`}>
                  <span className="alerta-item__icono" aria-hidden="true">
                    {al.nivel === 'verde' ? <ShieldCheck size={18} /> : al.nivel === 'info' ? <CalendarClock size={18} /> : <TriangleAlert size={18} />}
                  </span>
                  <div>
                    <small className="visualmente-oculto">{NOMBRE_ALERTA[al.nivel]}: </small>
                    <strong>{al.titulo}</strong>
                    <p>{al.detalle}</p>
                    {al.acciones.length > 0 && (
                      <div className="alerta__acciones">
                        {al.acciones.map((accion, i) => (
                          <button
                            key={accion.texto}
                            className={`boton boton--chico${i === 0 ? ' boton--chico-principal' : ''}`}
                            onClick={async () => {
                              setErrorAccion(null);
                              try {
                                if (await ejecutarAccion(espacioId, accion, navegar)) await alCambiarDatos();
                              } catch (err) {
                                setErrorAccion((err as Error).message);
                              }
                            }}
                          >
                            {accion.texto}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            {a.consejos.length > 0 ? (
              <ul className="consejos">
                {a.consejos.slice(0, 3).map((consejo) => (
                  <li key={consejo}>{consejo}</li>
                ))}
              </ul>
            ) : (
              <p className="contador">Registrá tus movimientos para empezar a ver avisos.</p>
            )}
            {!plan.modulos.includes('alertas') && (
              <p className="contador">
                <Lock size={12} aria-hidden="true" /> Los avisos antes de que falte plata están incluidos desde el plan Intermedio.
              </p>
            )}
          </>
        )}
      </section>

      {salud && <TarjetaSalud salud={salud.salud} />}

      <section className="card panel">
        <div className="panel__cabecera">
          <h2>Tu espacio</h2>
        </div>
        <ul className="modulos">
          <li>
            <a href="/mercado" onClick={irA('/mercado')}>
              Dólar, créditos e inversiones
            </a>
            <small className="etiqueta etiqueta--incluida">
              <Check size={14} aria-hidden="true" /> Listo para usar
            </small>
          </li>
          {a.modulos.map((m) => {
            const incluido = plan.modulos.includes(m);
            const destino = RUTA_DE_MODULO[m];
            const planNecesario = planes.find((p) => p.modulos.includes(m));
            return (
              <li key={m}>
                {destino && incluido ? (
                  <a href={destino} onClick={irA(destino)}>
                    {nombreModulo(m, usuario.tipo)}
                  </a>
                ) : !incluido ? (
                  <button type="button" className="modulo-bloqueado" onClick={() => alMejorar(nombreModulo(m, usuario.tipo), m)}>
                    {nombreModulo(m, usuario.tipo)}
                  </button>
                ) : (
                  <span>{nombreModulo(m, usuario.tipo)}</span>
                )}
                {!incluido ? (
                  <small className="etiqueta">
                    <Lock size={14} aria-hidden="true" /> {planNecesario ? `Desde el plan ${planNecesario.nombre}` : 'Otro plan'}
                  </small>
                ) : destino ? (
                  <small className="etiqueta etiqueta--incluida">
                    <Check size={14} aria-hidden="true" /> Listo para usar
                  </small>
                ) : (
                  <small className="etiqueta">En tu plan, próximamente</small>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
