import { useState, type FormEvent } from 'react';
import { api } from './api';
import type { Navegar } from './App';
import { CampoClave } from './comunes';
import { Marca } from './Marca';

export function Ingresar({ navegar, alIngresar }: { navegar: Navegar; alIngresar: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await api('/auth/ingresar', { metodo: 'POST', cuerpo: { email, clave } });
      await alIngresar();
    } catch (err) {
      setError((err as Error).message);
      setEnviando(false);
    }
  }

  return (
    <main className="acceso">
      <Marca />
      <h1 className="titular">Entrá a AURA</h1>
      <form className="formulario" onSubmit={enviar}>
        <label className="campo">
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <CampoClave etiqueta="Contraseña" valor={clave} alCambiar={setClave} />
        <a
          className="acceso__olvido"
          href="/recuperar"
          onClick={(e) => {
            e.preventDefault();
            navegar('/recuperar');
          }}
        >
          ¿Olvidaste tu contraseña?
        </a>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="boton boton--principal" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="acceso__pie">
        ¿Todavía no tenés cuenta?{' '}
        <a
          href="/registro"
          onClick={(e) => {
            e.preventDefault();
            navegar('/registro');
          }}
        >
          Crear una cuenta
        </a>
      </p>
    </main>
  );
}
