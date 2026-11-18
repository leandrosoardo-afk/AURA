import { useId, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, CircleHelp, CircleX, Eye, EyeOff, Lock } from 'lucide-react';
import type { Nivel } from '../shared/motor';

const NIVELES: Record<Nivel, { texto: string; Icono: typeof CircleCheck }> = {
  verde: { texto: 'Verde: tu caja está sana', Icono: CircleCheck },
  amarillo: { texto: 'Amarillo: precaución', Icono: CircleAlert },
  rojo: { texto: 'Rojo: riesgo de quedarte sin plata', Icono: CircleX },
  gris: { texto: 'Gris: falta información', Icono: CircleHelp },
};

/** El color nunca va solo: siempre lleva ícono y texto. */
export function EstadoNivel({ nivel }: { nivel: Nivel }) {
  const { texto, Icono } = NIVELES[nivel];
  return (
    <span className={`nivel nivel--${nivel}`}>
      <Icono size={18} strokeWidth={2} aria-hidden="true" />
      {texto}
    </span>
  );
}

export function puntoEnArco(fraccion: number, radio: number) {
  const angulo = Math.PI * (1 - fraccion);
  return { x: 100 + radio * Math.cos(angulo), y: 100 - radio * Math.sin(angulo) };
}

export function arcoSemi(desde: number, hasta: number) {
  const a = puntoEnArco(desde, 84);
  const b = puntoEnArco(hasta, 84);
  return `M${a.x.toFixed(2)} ${a.y.toFixed(2)} A84 84 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export function digitos(texto: string): number {
  return Number(texto.replace(/\D/g, ''));
}

export function textoPesos(monto: number): string {
  return `$ ${Math.round(monto).toLocaleString('es-AR')}`;
}

export function CampoPesos(props: { etiqueta: string; ayuda?: ReactNode; valor: string; alCambiar: (valor: string) => void; requerido?: boolean; autoFocus?: boolean }) {
  return (
    <label className="campo">
      {props.etiqueta}
      <input
        inputMode="numeric"
        autoFocus={props.autoFocus}
        required={props.requerido ?? true}
        placeholder="$ 0"
        value={props.valor}
        onChange={(e) => {
          const limpio = e.target.value.replace(/\D/g, '').slice(0, 13);
          props.alCambiar(limpio ? textoPesos(Number(limpio)) : '');
        }}
      />
      {props.ayuda && <small>{props.ayuda}</small>}
    </label>
  );
}

export function Bloqueo({ titulo, descripcion, plan }: { titulo: string; descripcion: string; plan: string }) {
  return (
    <div className="pantalla">
      <h1 className="titulo-pantalla">{titulo}</h1>
      <div className="vacio">
        <Lock size={32} strokeWidth={1.5} aria-hidden="true" />
        <p>{descripcion}</p>
        <p>Está incluido desde el plan {plan}.</p>
      </div>
    </div>
  );
}

/** Campo de contraseña con el botón del ojito para mostrarla u ocultarla. */
export function CampoClave(props: { etiqueta: string; valor: string; alCambiar: (valor: string) => void; nueva?: boolean; ayuda?: string; autoFocus?: boolean }) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <div className="campo">
      <label htmlFor={id}>{props.etiqueta}</label>
      <div className="campo-clave">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={props.nueva ? 'new-password' : 'current-password'}
          required
          minLength={props.nueva ? 8 : undefined}
          maxLength={props.nueva ? 72 : 200}
          autoFocus={props.autoFocus}
          aria-describedby={props.ayuda ? `${id}-ayuda` : undefined}
          value={props.valor}
          onChange={(e) => props.alCambiar(e.target.value)}
        />
        <button type="button" className="campo-clave__ojo" aria-label={visible ? 'Ocultar la contraseña' : 'Mostrar la contraseña'} aria-pressed={visible} onClick={() => setVisible(!visible)}>
          {visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
        </button>
      </div>
      {props.ayuda && <small id={`${id}-ayuda`}>{props.ayuda}</small>}
    </div>
  );
}

/**
 * Campo trampa contra bots: una persona no lo ve ni lo completa; un bot que llena todo, sí.
 * Va junto con el tiempo que tardó en enviar el formulario.
 */
export function CampoTrampa({ valor, alCambiar }: { valor: string; alCambiar: (valor: string) => void }) {
  return (
    <div className="campo-trampa" aria-hidden="true">
      <label>
        Sitio web
        <input type="text" name="sitio" tabIndex={-1} autoComplete="off" value={valor} onChange={(e) => alCambiar(e.target.value)} />
      </label>
    </div>
  );
}
