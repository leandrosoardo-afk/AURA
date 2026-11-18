import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Mic, Send, Sparkles, Square, X } from 'lucide-react';
import { responder, SUGERENCIAS_INICIALES, type Accion, type ContextoAyuda, type RespuestaAyuda } from '../shared/ayuda';
import { api, type Plan, type Yo } from './api';
import type { Navegar } from './App';
import { useDictado } from './dictado';

interface Mensaje {
  id: number;
  autor: 'usuario' | 'clara';
  texto: string;
  accion?: Accion;
  sugerencias?: string[];
  origen?: 'gemini' | 'local';
}

const BIENVENIDA = 'Hola, soy el asistente de AURA. Te ayudo a usar la app y a encontrar cada sección. ¿Qué necesitás?';

export function Ayuda({ yo, planes, navegar, abierto, alCerrar }: { yo: Yo; planes: Plan[]; navegar: Navegar; abierto: boolean; alCerrar: () => void }) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([{ id: 0, autor: 'clara', texto: BIENVENIDA }]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const [conIA, setConIA] = useState(false);
  const [planIA, setPlanIA] = useState<string | null>(null);
  const lista = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);

  const contexto: ContextoAyuda = useMemo(
    () => ({
      tipo: yo.usuario.tipo,
      plan: yo.plan.nombre,
      modulos: yo.plan.modulos,
      planDe: (modulo) => planes.find((p) => p.modulos.includes(modulo))?.nombre ?? 'Intermedio',
    }),
    [yo, planes],
  );

  useEffect(() => {
    if (!abierto) return;
    campo.current?.focus();
    api<{ ia: boolean; planIA?: string }>('/ayuda/estado')
      .then((r) => {
        setConIA(r.ia);
        setPlanIA(r.planIA ?? null);
      })
      .catch(() => setConIA(false));
  }, [abierto]);

  useEffect(() => {
    const el = lista.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensajes, abierto, pensando]);

  function cerrar() {
    alCerrar();
  }

  async function preguntar(pregunta: string) {
    const limpia = pregunta.trim();
    if (!limpia || pensando) return;
    // Lo último de la charla, para que entienda preguntas como "¿y eso dónde está?".
    const historial = mensajes.slice(1).slice(-6).map((m) => ({ autor: m.autor, texto: m.texto.slice(0, 1000) }));
    setMensajes((m) => [...m, { id: m.length, autor: 'usuario', texto: limpia }]);
    setTexto('');
    setPensando(true);
    let r: RespuestaAyuda & { origen?: 'gemini' | 'local' };
    try {
      r = await api('/ayuda', { metodo: 'POST', cuerpo: { pregunta: limpia, historial } });
    } catch {
      // Sin conexión con el servidor la guía sigue funcionando, porque también vive en el navegador.
      r = { ...responder(limpia, contexto), origen: 'local' };
    }
    setMensajes((m) => [...m, { id: m.length, autor: 'clara', texto: r.texto, accion: r.accion, sugerencias: r.sugerencias, origen: r.origen }]);
    setPensando(false);
    campo.current?.focus();
  }

  // Dictado: lo que la persona dice se va escribiendo en el campo y, cuando termina de hablar, se envía solo.
  const dictado = useDictado({
    alEscuchar: (dicho) => setTexto(dicho),
    alTerminar: (dicho) => void preguntar(dicho),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    void preguntar(texto);
  }

  if (!abierto) return null;

  return (
    <section
      className="ayuda"
      role="dialog"
      aria-label="Ayuda de AURA"
      onKeyDown={(e) => {
        if (e.key === 'Escape') cerrar();
      }}
    >
      <header className="ayuda__cabecera">
        <span className="ayuda__titulo">
          <img src="/asistente-aura.gif" alt="" width={32} height={32} />
          <span>
            <strong>Asistente AURA</strong>
            <small>{conIA ? 'Con Gemini' : planIA ? `Guía de la app · IA en el plan ${planIA}` : 'Guía de la app'}</small>
          </span>
        </span>
        <button className="boton-icono" aria-label="Cerrar el asistente" onClick={cerrar}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="ayuda__mensajes" ref={lista} aria-live="polite">
        {mensajes.map((m) => (
          <div key={m.id} className={`mensaje mensaje--${m.autor}`}>
            <p>{m.texto}</p>
            {m.origen === 'gemini' && (
              <small className="mensaje__origen">
                <Sparkles size={12} aria-hidden="true" /> Respondido con Gemini
              </small>
            )}
            {m.accion && (
              <button
                className="mensaje__accion"
                onClick={() => {
                  navegar(m.accion!.ruta);
                  cerrar();
                }}
              >
                {m.accion.texto}
              </button>
            )}
            {m.sugerencias && (
              <div className="ayuda__sugerencias">
                {m.sugerencias.map((s) => (
                  <button key={s} className="chip" disabled={pensando} onClick={() => preguntar(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {pensando && (
          <div className="mensaje mensaje--clara">
            <p className="mensaje__pensando">Pensando…</p>
          </div>
        )}
        {mensajes.length === 1 && (
          <div className="ayuda__sugerencias">
            {SUGERENCIAS_INICIALES.map((s) => (
              <button key={s} className="chip" disabled={pensando} onClick={() => preguntar(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
      <form className="ayuda__formulario" onSubmit={enviar}>
        <input
          ref={campo}
          aria-label="Escribí tu pregunta"
          placeholder={dictado.escuchando ? 'Te escucho…' : 'Escribí o tocá el micrófono'}
          maxLength={300}
          value={texto}
          readOnly={dictado.escuchando}
          onChange={(e) => setTexto(e.target.value)}
        />
        <button
          type="button"
          className={`boton-icono ayuda__microfono${dictado.escuchando ? ' ayuda__microfono--escuchando' : ''}${dictado.disponible ? '' : ' ayuda__microfono--no-disponible'}`}
          aria-label={dictado.escuchando ? 'Dejar de escuchar' : 'Hablar en vez de escribir'}
          aria-pressed={dictado.escuchando}
          title={dictado.disponible ? (dictado.escuchando ? 'Dejar de escuchar' : 'Hablar en vez de escribir') : 'Este navegador no permite dictar'}
          disabled={pensando}
          onClick={() => (dictado.escuchando ? dictado.detener() : dictado.empezar())}
        >
          {dictado.escuchando ? <Square size={16} fill="currentColor" aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}
        </button>
        <button className="boton-icono" aria-label="Enviar" disabled={!texto.trim() || pensando || dictado.escuchando}>
          <Send size={20} aria-hidden="true" />
        </button>
      </form>
      {dictado.escuchando && (
        <p className="ayuda__escuchando" role="status">
          <span className="ayuda__onda" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Te escucho. Cuando termines de hablar, lo envío solo.
        </p>
      )}
      {dictado.error && (
        <p className="ayuda__error-voz" role="alert">
          {dictado.error}
        </p>
      )}
      <p className="ayuda__pie">
        Te ayudo con la app y con dudas generales de plata. No conozco tus números ni te digo qué hacer con ellos.
        {conIA && ' Tus preguntas se envían a Google Gemini: no escribas datos personales.'}
      </p>
    </section>
  );
}
