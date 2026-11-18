import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera, Check, ImageUp, Monitor, Moon, RotateCcw, Sun, Trash2 } from 'lucide-react';
import { nombreModulo, type ModuloId } from '../shared/adaptacion';
import { PREGUNTAS } from '../shared/cuestionario';
import { api, formatoPesos, type Plan, type Yo } from './api';
import { CampoClave } from './comunes';
import { Hoja } from './RegistroRapido';

type Tema = 'light' | 'dark' | null;

/** La foto del usuario o, si no tiene, la inicial de su nombre. */
export function Avatar({ perfil, grande = false }: { perfil: Yo['perfil']; grande?: boolean }) {
  const [fallo, setFallo] = useState(false);
  const clase = `avatar${grande ? ' avatar--grande' : ''}`;
  if (perfil.fotoVersion && !fallo) {
    return <img className={`${clase} avatar--foto`} src={`/api/perfil/foto?v=${perfil.fotoVersion}`} alt="" onError={() => setFallo(true)} />;
  }
  return (
    <span className={clase} aria-hidden="true">
      {perfil.nombre.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

const LADO_FOTO = 256;

/** Dibuja el centro cuadrado de una imagen o del video en 256 px y lo devuelve como JPEG. */
function recortarCuadrado(fuente: CanvasImageSource, ancho: number, alto: number, espejar = false): string {
  const lado = Math.min(ancho, alto);
  const lienzo = document.createElement('canvas');
  lienzo.width = LADO_FOTO;
  lienzo.height = LADO_FOTO;
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('No pudimos preparar la foto.');
  if (espejar) {
    // La vista previa de la cámara se ve como un espejo: la foto queda igual a lo que viste.
    ctx.translate(LADO_FOTO, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(fuente, (ancho - lado) / 2, (alto - lado) / 2, lado, lado, 0, 0, LADO_FOTO, LADO_FOTO);
  return lienzo.toDataURL('image/jpeg', 0.85);
}

/** Recorta la imagen al centro en un cuadrado de 256 px y la pasa a JPEG, así pesa poco. */
async function achicarFoto(archivo: File): Promise<string> {
  try {
    // Se lee como data URL: la política de seguridad del servidor no deja cargar imágenes blob:.
    const url = await new Promise<string>((ok, mal) => {
      const lector = new FileReader();
      lector.onload = () => ok(String(lector.result));
      lector.onerror = () => mal(lector.error);
      lector.readAsDataURL(archivo);
    });
    const imagen = new Image();
    imagen.src = url;
    await imagen.decode();
    return recortarCuadrado(imagen, imagen.naturalWidth, imagen.naturalHeight);
  } catch {
    throw new Error('No pudimos leer esa imagen. Probá con una foto JPG o PNG.');
  }
}

/** Saca una foto con la cámara de la compu o del celular. */
function Camara({ alUsar }: { alUsar: (foto: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const flujo = useRef<MediaStream | null>(null);
  const [lista, setLista] = useState(false);
  const [captura, setCaptura] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este navegador no deja usar la cámara. Probá con "Subir una foto".');
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
        if (cancelado) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        flujo.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
        setLista(true);
      } catch (err) {
        const nombre = (err as DOMException).name;
        setError(
          nombre === 'NotAllowedError'
            ? 'No diste permiso para usar la cámara. Podés habilitarlo en el candado de la barra de direcciones, o subir una foto.'
            : nombre === 'NotFoundError'
              ? 'No encontramos una cámara en este dispositivo. Probá con "Subir una foto".'
              : 'No pudimos abrir la cámara. Fijate que no la esté usando otra aplicación.',
        );
      }
    })();
    // Al cerrar se apaga la cámara (se apaga la lucecita).
    return () => {
      cancelado = true;
      flujo.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function sacar() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    // La vista previa se ve como espejo, pero la foto se guarda derecha, como la ven los demás.
    setCaptura(recortarCuadrado(v, v.videoWidth, v.videoHeight));
  }

  if (error) {
    return (
      <div className="camara">
        <p className="error" role="alert">
          {error}
        </p>
      </div>
    );
  }
  return (
    <div className="camara">
      <div className="camara__visor">
        <video ref={video} className="camara__video" playsInline muted hidden={Boolean(captura)} aria-label="Vista de la cámara" />
        {captura && <img className="camara__video camara__captura" src={captura} alt="La foto que sacaste" />}
        {!lista && !captura && <p className="contador camara__esperando">Abriendo la cámara…</p>}
      </div>
      {captura ? (
        <div className="camara__acciones">
          <button type="button" className="boton boton--secundario boton--icono" onClick={() => setCaptura(null)}>
            <RotateCcw size={18} aria-hidden="true" /> Repetir
          </button>
          <button type="button" className="boton boton--principal boton--icono" onClick={() => alUsar(captura)}>
            <Check size={18} aria-hidden="true" /> Usar esta foto
          </button>
        </div>
      ) : (
        <div className="camara__acciones">
          <button type="button" className="boton boton--principal boton--icono" disabled={!lista} onClick={sacar}>
            <Camera size={18} aria-hidden="true" /> Sacar foto
          </button>
        </div>
      )}
    </div>
  );
}

/** Lo que se pierde al bajar de plan: los módulos que hoy tiene y el plan nuevo no. */
function modulosQueSePierden(actual: Plan, nuevo: Plan, tipo: Yo['usuario']['tipo']): string[] {
  return actual.modulos
    .filter((m) => !nuevo.modulos.includes(m) && m !== 'movimientos')
    .map((m) => {
      try {
        return nombreModulo(m as ModuloId, tipo);
      } catch {
        return m;
      }
    });
}

export function Configuracion({
  yo,
  tema,
  alElegirTema,
  alActualizar,
  alSalir,
}: {
  yo: Yo;
  tema: Tema;
  alElegirTema: (tema: Tema) => void;
  alActualizar: () => Promise<void>;
  alSalir: () => Promise<void>;
}) {
  const { usuario, perfil, plan, espacios } = yo;
  const pyme = usuario.tipo === 'pyme';

  const [nombre, setNombre] = useState(perfil.nombre);
  const [apellido, setApellido] = useState(perfil.apellido ?? '');
  const [negocio, setNegocio] = useState(perfil.nombreNegocio ?? espacios[0].nombre);
  const [guardando, setGuardando] = useState(false);
  const [estadoPerfil, setEstadoPerfil] = useState<{ error?: string; ok?: string }>({});

  const archivo = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [camaraAbierta, setCamaraAbierta] = useState(false);
  const cerrarCamara = useCallback(() => setCamaraAbierta(false), []);

  const [planes, setPlanes] = useState<Plan[]>([]);
  const [planElegido, setPlanElegido] = useState<string | null>(null);
  const [cambiandoPlan, setCambiandoPlan] = useState(false);
  const [estadoPlan, setEstadoPlan] = useState<{ error?: string; ok?: string }>({});

  useEffect(() => {
    api<{ planes: Plan[] }>('/planes')
      .then((r) => setPlanes(r.planes))
      .catch(() => setPlanes([]));
  }, []);
  const [estadoFoto, setEstadoFoto] = useState<{ error?: string; ok?: string }>({});

  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [cambiando, setCambiando] = useState(false);
  const [estadoClave, setEstadoClave] = useState<{ error?: string; ok?: string }>({});

  const cambios = nombre.trim() !== perfil.nombre || apellido.trim() !== (perfil.apellido ?? '') || (pyme && negocio.trim() !== (perfil.nombreNegocio ?? espacios[0].nombre));

  async function guardarPerfil(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setEstadoPerfil({});
    try {
      await api('/perfil', { metodo: 'PUT', cuerpo: { nombre, apellido, ...(pyme ? { nombreNegocio: negocio } : {}) } });
      await alActualizar();
      setEstadoPerfil({ ok: 'Guardamos tus datos.' });
    } catch (err) {
      setEstadoPerfil({ error: (err as Error).message });
    } finally {
      setGuardando(false);
    }
  }

  async function subirFoto(obtener: () => Promise<string>) {
    setSubiendo(true);
    setEstadoFoto({});
    try {
      await api('/perfil/foto', { metodo: 'PUT', cuerpo: { foto: await obtener() } });
      await alActualizar();
      setEstadoFoto({ ok: 'Listo, actualizamos tu foto.' });
    } catch (err) {
      setEstadoFoto({ error: (err as Error).message });
    } finally {
      setSubiendo(false);
    }
  }

  function elegirFoto(e: ChangeEvent<HTMLInputElement>) {
    const elegido = e.target.files?.[0];
    e.target.value = '';
    if (!elegido) return;
    void subirFoto(async () => {
      if (!elegido.type.startsWith('image/')) throw new Error('Elegí una imagen JPG, PNG o WebP.');
      return achicarFoto(elegido);
    });
  }

  function usarCaptura(foto: string) {
    setCamaraAbierta(false);
    void subirFoto(async () => foto);
  }

  async function cambiarPlan(codigo: string) {
    setCambiandoPlan(true);
    setEstadoPlan({});
    try {
      await api('/suscripcion', { metodo: 'PUT', cuerpo: { plan: codigo } });
      await alActualizar();
      setPlanElegido(null);
      setEstadoPlan({ ok: `Listo, ahora tenés el plan ${planes.find((p) => p.codigo === codigo)?.nombre ?? codigo}.` });
    } catch (err) {
      setEstadoPlan({ error: (err as Error).message });
    } finally {
      setCambiandoPlan(false);
    }
  }

  async function sacarFoto() {
    setSubiendo(true);
    setEstadoFoto({});
    try {
      await api('/perfil/foto', { metodo: 'DELETE' });
      await alActualizar();
      setEstadoFoto({ ok: 'Sacamos tu foto.' });
    } catch (err) {
      setEstadoFoto({ error: (err as Error).message });
    } finally {
      setSubiendo(false);
    }
  }

  async function cambiarClave(e: FormEvent) {
    e.preventDefault();
    setCambiando(true);
    setEstadoClave({});
    try {
      await api('/auth/cambiar-clave', { metodo: 'POST', cuerpo: { actual, nueva } });
      setActual('');
      setNueva('');
      setEstadoClave({ ok: 'Cambiamos tu contraseña. Si tenías la cuenta abierta en otro lado, ahí vas a tener que entrar de nuevo.' });
    } catch (err) {
      setEstadoClave({ error: (err as Error).message });
    } finally {
      setCambiando(false);
    }
  }

  const estado = (e: { error?: string; ok?: string }) =>
    e.error ? (
      <p className="error" role="alert">
        {e.error}
      </p>
    ) : (
      <p className="aviso" role="status">
        {e.ok}
      </p>
    );

  return (
    <div className="pantalla configuracion">
      <h1 className="titulo-pantalla">Configuración</h1>

      <section className="card panel" aria-labelledby="config-perfil">
        <h2 id="config-perfil">Tu perfil</h2>
        <div className="config-foto">
          <Avatar perfil={perfil} grande />
          <div className="config-foto__acciones">
            <input ref={archivo} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={elegirFoto} />
            <button type="button" className="boton boton--secundario boton--icono" disabled={subiendo} onClick={() => archivo.current?.click()}>
              <ImageUp size={18} aria-hidden="true" /> {subiendo ? 'Subiendo…' : 'Subir una foto'}
            </button>
            <button type="button" className="boton boton--secundario boton--icono" disabled={subiendo} onClick={() => setCamaraAbierta(true)}>
              <Camera size={18} aria-hidden="true" /> Sacarme una foto
            </button>
            {perfil.fotoVersion && (
              <button type="button" className="boton-texto boton-texto--peligro" disabled={subiendo} onClick={sacarFoto}>
                <Trash2 size={16} aria-hidden="true" /> Sacar foto
              </button>
            )}
            <small className="contador">Elegí una foto de tu compu o celular (JPG, PNG o WebP), o sacate una con la cámara. La recortamos cuadrada.</small>
          </div>
        </div>
        {estado(estadoFoto)}

        <form className="config-form" onSubmit={guardarPerfil}>
          <div className="config-form__fila">
            <label className="campo">
              Nombre
              <input required maxLength={60} autoComplete="given-name" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </label>
            <label className="campo">
              Apellido
              <input maxLength={60} autoComplete="family-name" value={apellido} onChange={(e) => setApellido(e.target.value)} />
            </label>
          </div>
          {pyme && (
            <label className="campo">
              Nombre del negocio
              <input required maxLength={80} autoComplete="organization" value={negocio} onChange={(e) => setNegocio(e.target.value)} />
            </label>
          )}
          <label className="campo">
            Email
            <input value={usuario.email} readOnly aria-describedby="config-email-ayuda" />
            <small id="config-email-ayuda">Con este mail entrás a AURA. Por ahora no se puede cambiar.</small>
          </label>
          {estado(estadoPerfil)}
          <button className="boton boton--principal" disabled={guardando || !cambios}>
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </form>
      </section>

      <section className="card panel" aria-labelledby="config-apariencia">
        <h2 id="config-apariencia">Apariencia</h2>
        <div className="segmentado segmentado--tres config-tema" role="group" aria-label="Modo de color">
          {(
            [
              ['light', 'Claro', Sun],
              ['dark', 'Oscuro', Moon],
              [null, 'Automático', Monitor],
            ] as const
          ).map(([valor, texto, Icono]) => (
            <button key={texto} type="button" aria-pressed={tema === valor} onClick={() => alElegirTema(valor)}>
              <Icono size={16} aria-hidden="true" /> {texto}
            </button>
          ))}
        </div>
        <p className="contador">Automático usa el modo que tenga elegido tu compu o tu celular.</p>
      </section>

      <section className="card panel" aria-labelledby="config-clave">
        <h2 id="config-clave">Contraseña</h2>
        <form className="config-form" onSubmit={cambiarClave}>
          <CampoClave etiqueta="Contraseña actual" valor={actual} alCambiar={setActual} />
          <CampoClave etiqueta="Contraseña nueva" valor={nueva} alCambiar={setNueva} nueva ayuda="Al menos 8 caracteres." />
          {estado(estadoClave)}
          <button className="boton boton--secundario" disabled={cambiando}>
            {cambiando ? 'Cambiando…' : 'Cambiar contraseña'}
          </button>
        </form>
      </section>

      <section className="card panel" aria-labelledby="config-plan">
        <h2 id="config-plan">Tu suscripción</h2>
        <p className="contador">
          Tenés el plan <strong>{plan.nombre}</strong>. Podés subir o bajar de plan cuando quieras. Por ahora no se cobra nada.
        </p>
        <div className="planes-config">
          {(planes.length ? planes : [plan]).map((p) => {
            const actual = p.codigo === plan.codigo;
            const sube = p.precio_mensual_ars > plan.precio_mensual_ars;
            const pierde = actual ? [] : modulosQueSePierden(plan, p, usuario.tipo);
            return (
              <article key={p.codigo} className={`plan-config${actual ? ' plan-config--actual' : ''}`} aria-label={`Plan ${p.nombre}`}>
                <header>
                  <h3>{p.nombre}</h3>
                  <p className="plan-config__precio">{p.precio_mensual_ars > 0 ? `${formatoPesos(p.precio_mensual_ars)} por mes` : 'Gratis'}</p>
                </header>
                <ul className="consejos">
                  {p.beneficios.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
                {actual ? (
                  <p className="plan-config__actual">
                    <Check size={16} aria-hidden="true" /> Tu plan actual
                  </p>
                ) : planElegido === p.codigo ? (
                  <div className="plan-config__confirmar" role="group" aria-label={`Confirmar el cambio al plan ${p.nombre}`}>
                    <p>
                      {sube ? `Vas a pasar al plan ${p.nombre}.` : `Vas a bajar al plan ${p.nombre}.`}
                      {pierde.length > 0 && ` Dejás de tener: ${pierde.join(', ')}. Tus datos no se borran: vuelven a aparecer si subís de nuevo.`}
                      {p.incluye_publicidad && ' Este plan muestra publicidad.'}
                    </p>
                    <div className="plan-config__botones">
                      <button type="button" className="boton boton--principal" disabled={cambiandoPlan} onClick={() => cambiarPlan(p.codigo)}>
                        {cambiandoPlan ? 'Cambiando…' : 'Confirmar'}
                      </button>
                      <button type="button" className="boton-texto" onClick={() => setPlanElegido(null)}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className={`boton ${sube ? 'boton--principal' : 'boton--secundario'}`} onClick={() => setPlanElegido(p.codigo)}>
                    {sube ? `Subir a ${p.nombre}` : `Bajar a ${p.nombre}`}
                  </button>
                )}
              </article>
            );
          })}
        </div>
        {estado(estadoPlan)}
      </section>

      <section className="card panel" aria-labelledby="config-cuenta">
        <h2 id="config-cuenta">Tu cuenta</h2>
        <dl className="datos">
          <div>
            <dt>Tipo de usuario</dt>
            <dd>{pyme ? 'Usuario PyME' : 'Usuario persona'}</dd>
          </div>
          <div>
            <dt>Espacio de trabajo</dt>
            <dd>{espacios[0].nombre}. Solo vos podés entrar.</dd>
          </div>
          {PREGUNTAS[usuario.tipo].map((p) => {
            const valor = perfil.respuestas[p.id];
            const valores = Array.isArray(valor) ? valor : [valor];
            return (
              <div key={p.id}>
                <dt>{p.titulo}</dt>
                <dd>{valores.map((v) => p.opciones.find((o) => o.valor === v)?.texto ?? v).join(', ')}</dd>
              </div>
            );
          })}
        </dl>
      </section>

      <button className="boton boton--secundario boton--inicio" onClick={alSalir}>
        Salir de la cuenta
      </button>

      <Hoja titulo="Sacarme una foto" abierta={camaraAbierta} alCerrar={cerrarCamara}>
        <Camara alUsar={usarCaptura} />
      </Hoja>
    </div>
  );
}
