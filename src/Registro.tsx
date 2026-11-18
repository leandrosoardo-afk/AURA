import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Store, UserRound } from 'lucide-react';
import { adaptarInterfaz, nombreModulo } from '../shared/adaptacion';
import { PREGUNTAS, type Pregunta, type Respuestas, type TipoUsuario } from '../shared/cuestionario';
import { api, ErrorApi, formatoPesos, type Plan } from './api';
import type { Navegar } from './App';
import { CampoClave, CampoTrampa } from './comunes';
import { Marca } from './Marca';

export function Registro({ navegar, alCrear }: { navegar: Navegar; alCrear: () => Promise<void> }) {
  const [paso, setPaso] = useState(0);
  const [tipo, setTipo] = useState<TipoUsuario | null>(null);
  const [cuenta, setCuenta] = useState({ nombre: '', nombreNegocio: '', email: '', clave: '' });
  const [respuestas, setRespuestas] = useState<Respuestas>({});
  const [planes, setPlanes] = useState<Plan[] | null>(null);
  const [plan, setPlan] = useState<string | null>(() => new URLSearchParams(window.location.search).get('plan'));
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [sitio, setSitio] = useState('');
  const abierto = useRef(performance.now());
  const titulo = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    api<{ planes: Plan[] }>('/planes')
      .then((r) => setPlanes(r.planes))
      .catch((e) => setError(e.message));
  }, []);

  const preguntas = tipo ? PREGUNTAS[tipo] : [];
  const pasoPlan = 2 + preguntas.length;
  const totalPasos = tipo ? pasoPlan + 1 : 8;
  const pregunta = paso >= 2 && paso < pasoPlan ? preguntas[paso - 2] : null;

  // Al cambiar de paso, el foco va al título para que el lector de pantalla anuncie la pregunta.
  useEffect(() => {
    if (paso > 0) titulo.current?.focus();
  }, [paso]);

  function responder(p: Pregunta, valor: string) {
    if (p.multiple) {
      const actuales = (respuestas[p.id] as string[] | undefined) ?? [];
      setRespuestas({ ...respuestas, [p.id]: actuales.includes(valor) ? actuales.filter((v) => v !== valor) : [...actuales, valor] });
    } else {
      setRespuestas({ ...respuestas, [p.id]: valor });
      setPaso(paso + 1);
    }
  }

  function elegirTipo(nuevo: TipoUsuario) {
    if (nuevo !== tipo) setRespuestas({});
    setTipo(nuevo);
    setPaso(1);
  }

  async function crearCuenta() {
    setError(null);
    setEnviando(true);
    try {
      await api('/auth/registro', { metodo: 'POST', cuerpo: { tipo, ...cuenta, nombreNegocio: tipo === 'pyme' ? cuenta.nombreNegocio : undefined, plan, respuestas, sitio, demora: Math.round(performance.now() - abierto.current) } });
      await alCrear();
      navegar('/');
    } catch (err) {
      setError((err as Error).message);
      // Un email repetido se corrige en el paso de la cuenta, sin perder las respuestas.
      if (err instanceof ErrorApi && err.campo === 'email') setPaso(1);
      setEnviando(false);
    }
  }

  function continuarCuenta(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPaso(2);
  }

  const c = (campo: keyof typeof cuenta) => ({
    value: cuenta[campo],
    onChange: (e: { target: { value: string } }) => setCuenta({ ...cuenta, [campo]: e.target.value }),
  });

  const enPlanes = paso === pasoPlan;

  return (
    <div className={`alta${enPlanes ? ' alta--planes' : ''}`}>
      <main className="alta__principal">
        <div className="alta__barra">
          <Marca />
          {paso > 0 && (
            <button className="boton-texto" onClick={() => setPaso(paso - 1)}>
              <ArrowLeft size={18} aria-hidden="true" /> Volver
            </button>
          )}
        </div>
        <div
          className="progreso"
          role="progressbar"
          aria-label="Avance del alta"
          aria-valuemin={1}
          aria-valuemax={totalPasos}
          aria-valuenow={paso + 1}
        >
          <span style={{ width: `${((paso + 1) / totalPasos) * 100}%` }} />
        </div>

        {paso === 0 && (
          <section>
            <h1 className="titular">¿Cómo vas a usar AURA?</h1>
            <div className="tipos">
              <button className="tipo" onClick={() => elegirTipo('pyme')}>
                <Store size={28} strokeWidth={1.75} aria-hidden="true" />
                <strong>Usuario PyME</strong>
                <span>Tengo un negocio o un emprendimiento y quiero ordenar su caja.</span>
              </button>
              <button className="tipo" onClick={() => elegirTipo('persona')}>
                <UserRound size={28} strokeWidth={1.75} aria-hidden="true" />
                <strong>Usuario persona</strong>
                <span>Quiero ordenar mi plata y la de mi casa.</span>
              </button>
            </div>
            <p className="alta__pie">
              ¿Ya tenés cuenta?{' '}
              <a
                href="/ingresar"
                onClick={(e) => {
                  e.preventDefault();
                  navegar('/ingresar');
                }}
              >
                Entrar
              </a>
            </p>
          </section>
        )}

        {paso === 1 && (
          <section>
            <h1 className="titular" tabIndex={-1} ref={titulo}>
              Creá tu cuenta
            </h1>
            <form className="formulario" onSubmit={continuarCuenta}>
              <CampoTrampa valor={sitio} alCambiar={setSitio} />
              <label className="campo">
                Tu nombre
                <input autoComplete="given-name" required maxLength={80} autoFocus {...c('nombre')} />
              </label>
              {tipo === 'pyme' && (
                <label className="campo">
                  Nombre de tu negocio
                  <input autoComplete="organization" required maxLength={80} {...c('nombreNegocio')} />
                </label>
              )}
              <label className="campo">
                Email
                <input type="email" autoComplete="email" required maxLength={254} {...c('email')} />
              </label>
              <CampoClave etiqueta="Contraseña" valor={cuenta.clave} alCambiar={(clave) => setCuenta({ ...cuenta, clave })} nueva ayuda="Al menos 8 caracteres." />
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button className="boton boton--principal">Continuar</button>
            </form>
          </section>
        )}

        {pregunta && (
          <section key={pregunta.id}>
            <h1 className="titular" tabIndex={-1} ref={titulo}>
              {pregunta.titulo}
            </h1>
            {pregunta.ayuda && <p className="alta__ayuda">{pregunta.ayuda}</p>}
            <div className="opciones" role="group" aria-label={pregunta.titulo}>
              {pregunta.opciones.map((o) => {
                const valor = respuestas[pregunta.id];
                const elegida = Array.isArray(valor) ? valor.includes(o.valor) : valor === o.valor;
                return (
                  <button key={o.valor} className={`opcion${elegida ? ' opcion--elegida' : ''}`} aria-pressed={elegida} onClick={() => responder(pregunta, o.valor)}>
                    {o.texto}
                    {elegida && <Check size={20} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            {pregunta.multiple && (
              <button className="boton boton--principal" disabled={!(respuestas[pregunta.id] as string[] | undefined)?.length} onClick={() => setPaso(paso + 1)}>
                Continuar
              </button>
            )}
          </section>
        )}

        {enPlanes && (
          <section>
            <h1 className="titular" tabIndex={-1} ref={titulo}>
              Elegí tu plan
            </h1>
            <div className="planes" role="radiogroup" aria-label="Planes">
              {planes?.map((p) => (
                <label key={p.codigo} className={`plan${plan === p.codigo ? ' plan--elegido' : ''}`}>
                  <input type="radio" name="plan" value={p.codigo} checked={plan === p.codigo} onChange={() => setPlan(p.codigo)} />
                  <strong className="plan__nombre">{p.nombre}</strong>
                  <span className="plan__precio">
                    {formatoPesos(p.precio_mensual_ars)}
                    {p.precio_mensual_ars > 0 && <small> por mes</small>}
                  </span>
                  <ul>
                    {p.beneficios.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </label>
              ))}
            </div>
            <p className="alta__ayuda">Elegir un plan no genera ningún cobro y no te pedimos datos de pago.</p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="boton boton--principal" disabled={!planes?.some((p) => p.codigo === plan) || enviando} onClick={crearCuenta}>
              {enviando ? 'Creando tu cuenta…' : 'Crear mi cuenta'}
            </button>
          </section>
        )}
      </main>

      {!enPlanes && <VistaPrevia tipo={tipo} respuestas={respuestas} nombre={cuenta.nombre} negocio={cuenta.nombreNegocio} />}
    </div>
  );
}

/** El Inicio de esta persona, armado en vivo con la misma función que usa la app. */
function VistaPrevia({ tipo, respuestas, nombre, negocio }: { tipo: TipoUsuario | null; respuestas: Respuestas; nombre: string; negocio: string }) {
  const adaptacion = useMemo(() => (tipo ? adaptarInterfaz(tipo, respuestas) : null), [tipo, respuestas]);
  const lista = useRef<HTMLOListElement>(null);
  const posiciones = useRef(new Map<string, number>());

  // Anima el reordenamiento: cada módulo se desliza desde donde estaba hasta su nuevo lugar.
  useLayoutEffect(() => {
    const items = Array.from(lista.current?.children ?? []) as HTMLElement[];
    const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const item of items) {
      const id = item.dataset.id!;
      const top = item.offsetTop;
      const antes = posiciones.current.get(id);
      if (antes !== undefined && antes !== top && !reducir) {
        item.animate([{ transform: `translateY(${antes - top}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
      posiciones.current.set(id, top);
    }
  }, [adaptacion]);

  return (
    <aside className="previa" aria-label="Vista previa de tu Inicio">
      <p className="previa__rotulo">Así va quedando tu Inicio</p>
      {!tipo || !adaptacion ? (
        <p className="previa__foco previa__foco--vacio">Tus respuestas van a armar esta pantalla.</p>
      ) : (
        <div className="previa__pantalla" aria-live="polite">
          <p className="previa__saludo">
            {nombre ? `Hola, ${nombre}` : 'Hola'}
            {tipo === 'pyme' && negocio ? `. ${negocio}` : ''}
          </p>
          <p className="previa__foco">{adaptacion.preguntaFoco}</p>
          <ol className="previa__modulos" ref={lista}>
            {adaptacion.modulos.slice(0, 4).map((m) => (
              <li key={m} data-id={m}>
                {nombreModulo(m, tipo)}
              </li>
            ))}
          </ol>
          <div className="previa__chips">
            {adaptacion.categorias.egreso.slice(0, 5).map((categoria) => (
              <span key={categoria}>{categoria}</span>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
