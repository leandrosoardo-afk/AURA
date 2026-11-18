import { useCallback, useEffect, useState } from 'react';
import { api, ErrorApi, type Yo } from './api';
import { Espacio } from './Espacio';
import { Ingresar } from './Ingresar';
import { PedirRecuperacion, Restablecer } from './Recuperar';
import { Registro } from './Registro';

export type Navegar = (ruta: string) => void;

export function App() {
  const [ruta, setRuta] = useState(window.location.pathname);
  // La parte "?…" de la dirección: lleva filtros, por ejemplo desde una tarjeta del Inicio.
  const [consulta, setConsulta] = useState(window.location.search);
  const [yo, setYo] = useState<Yo | null | undefined>(undefined);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const navegar: Navegar = useCallback((destino) => {
    window.history.pushState(null, '', destino);
    const [camino, resto] = destino.split('?');
    setRuta(camino);
    setConsulta(resto ? `?${resto}` : '');
    window.scrollTo(0, 0);
  }, []);

  const cargarYo = useCallback(async () => {
    setErrorCarga(null);
    try {
      setYo(await api<Yo>('/yo'));
    } catch (error) {
      if (error instanceof ErrorApi && error.status === 401) setYo(null);
      else setErrorCarga((error as Error).message);
    }
  }, []);

  useEffect(() => {
    void cargarYo();
    const alVolver = () => {
      setRuta(window.location.pathname);
      setConsulta(window.location.search);
    };
    window.addEventListener('popstate', alVolver);
    return () => window.removeEventListener('popstate', alVolver);
  }, [cargarYo]);

  // /restablecer abre aunque haya una sesión iniciada: el enlace del mail tiene que funcionar siempre.
  const deAcceso = ruta === '/registro' || ruta === '/ingresar' || ruta === '/recuperar';
  const publica = deAcceso || ruta === '/restablecer';

  useEffect(() => {
    if (yo === null && !publica) navegar('/ingresar');
    if (yo && deAcceso) navegar('/');
  }, [yo, publica, deAcceso, navegar]);

  if (errorCarga) {
    return (
      <main className="centrado">
        <p role="alert">{errorCarga}</p>
        <button className="boton boton--principal" onClick={cargarYo}>
          Probar de nuevo
        </button>
      </main>
    );
  }
  if (yo === undefined) return <main className="centrado" aria-busy="true" />;
  if (ruta === '/registro') return <Registro navegar={navegar} alCrear={cargarYo} />;
  if (ruta === '/ingresar') return <Ingresar navegar={navegar} alIngresar={cargarYo} />;
  if (ruta === '/recuperar') return <PedirRecuperacion navegar={navegar} />;
  if (ruta === '/restablecer') return <Restablecer navegar={navegar} />;
  if (!yo) return <main className="centrado" aria-busy="true" />;
  return <Espacio key={yo.usuario.id} yo={yo} ruta={ruta} consulta={consulta} navegar={navegar} alSalir={() => setYo(null)} alActualizar={cargarYo} />;
}
