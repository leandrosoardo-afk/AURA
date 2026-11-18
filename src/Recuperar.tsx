import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MailCheck } from 'lucide-react';
import { api } from './api';
import type { Navegar } from './App';
import { CampoClave, CampoTrampa } from './comunes';
import { Marca } from './Marca';

function Volver({ navegar }: { navegar: Navegar }) {
  return (
    <p className="acceso__pie">
      <a
        href="/ingresar"
        onClick={(e) => {
          e.preventDefault();
          navegar('/ingresar');
        }}
      >
        Volver a ingresar
      </a>
    </p>
  );
}

export function PedirRecuperacion({ navegar }: { navegar: Navegar }) {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [sitio, setSitio] = useState('');
  const abierto = useRef(performance.now());

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await api('/auth/recuperar', { metodo: 'POST', cuerpo: { email, sitio, demora: Math.round(performance.now() - abierto.current) } });
      setEnviado(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="acceso">
      <Marca />
      <h1 className="titular">Recuperá tu contraseña</h1>
      {enviado ? (
        <div className="confirmacion" role="status">
          <MailCheck size={28} aria-hidden="true" />
          <p>
            Si <strong>{email}</strong> tiene una cuenta en AURA, te mandamos un enlace para elegir una contraseña nueva. Vence en 1 hora.
          </p>
          <p className="contador">Si no lo ves en unos minutos, revisá la carpeta de spam.</p>
        </div>
      ) : (
        <form className="formulario" onSubmit={enviar}>
          <CampoTrampa valor={sitio} alCambiar={setSitio} />
          <p className="registro__intro">Escribí el email con el que te registraste y te mandamos un enlace para elegir una nueva.</p>
          <label className="campo">
            Email
            <input type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="boton boton--principal" disabled={enviando}>
            {enviando ? 'Enviando…' : 'Mandame el enlace'}
          </button>
        </form>
      )}
      <Volver navegar={navegar} />
    </main>
  );
}

export function Restablecer({ navegar }: { navegar: Navegar }) {
  // El token llega después del #. Se lee una vez y después se borra de la barra de direcciones
  // para que no quede a la vista. Leer y borrar van separados: React puede leer el estado inicial dos veces.
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token'));
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', '/restablecer');
  }, []);
  const [clave, setClave] = useState('');
  const [repetida, setRepetida] = useState('');
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (clave !== repetida) {
      setError('Las dos contraseñas no coinciden.');
      return;
    }
    setEnviando(true);
    try {
      await api('/auth/restablecer', { metodo: 'POST', cuerpo: { token, clave } });
      setListo(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="acceso">
      <Marca />
      <h1 className="titular">Elegí tu contraseña nueva</h1>
      {!token ? (
        <>
          <p className="error" role="alert">
            Este enlace no es válido. Pedí uno nuevo.
          </p>
          <button className="boton boton--principal" onClick={() => navegar('/recuperar')}>
            Pedir un enlace nuevo
          </button>
        </>
      ) : listo ? (
        <div className="confirmacion" role="status">
          <p>Listo, cambiaste tu contraseña. Por seguridad cerramos las sesiones que tenías abiertas.</p>
          <button className="boton boton--principal" onClick={() => navegar('/ingresar')}>
            Ingresar
          </button>
        </div>
      ) : (
        <form className="formulario" onSubmit={enviar}>
          <CampoClave etiqueta="Contraseña nueva" valor={clave} alCambiar={setClave} nueva ayuda="Al menos 8 caracteres." autoFocus />
          <CampoClave etiqueta="Repetila" valor={repetida} alCambiar={setRepetida} nueva />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="boton boton--principal" disabled={enviando}>
            {enviando ? 'Guardando…' : 'Guardar la contraseña'}
          </button>
          {error?.includes('Pedí uno nuevo') && (
            <a
              href="/recuperar"
              onClick={(e) => {
                e.preventDefault();
                navegar('/recuperar');
              }}
            >
              Pedir un enlace nuevo
            </a>
          )}
        </form>
      )}
      <Volver navegar={navegar} />
    </main>
  );
}
