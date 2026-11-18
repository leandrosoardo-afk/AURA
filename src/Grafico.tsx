import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fechaCorta, fmt, fmtCompacto, minimo, sumarDias } from '../shared/motor';

export interface Serie {
  nombre: string;
  valores: number[];
  clase: 'serie-1' | 'serie-2';
  punteada?: boolean;
}

interface Props {
  titulo: string;
  hoy: string;
  series: Serie[];
  reserva: number;
}

const MARGEN = { arriba: 16, derecha: 12, abajo: 28, izquierda: 60 };

/** Divide el rango en marcas redondas (1, 2 o 5 por potencia de 10). */
export function marcas(min: number, max: number): number[] {
  const rango = Math.max(max - min, 1);
  const bruto = rango / 4;
  const potencia = Math.pow(10, Math.floor(Math.log10(bruto)));
  const paso = [1, 2, 5, 10].map((f) => f * potencia).find((p) => p >= bruto)!;
  const salida: number[] = [];
  const tope = Math.ceil(max / paso) * paso;
  for (let v = Math.floor(min / paso) * paso; v <= tope + paso * 0.001; v += paso) salida.push(v);
  return salida;
}

export function Grafico({ titulo, hoy, series, reserva }: Props) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(640);
  const [dia, setDia] = useState<number | null>(null);
  const idDegrade = useId().replace(/:/g, '');

  useLayoutEffect(() => {
    const el = contenedor.current;
    if (!el) return;
    // clientWidth no cambia con el zoom de la página; getBoundingClientRect sí.
    setAncho(el.clientWidth);
    const observador = new ResizeObserver(([entrada]) => setAncho(entrada.contentRect.width));
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  const alto = ancho < 480 ? 220 : 280;
  const dias = series[0].valores.length - 1;
  const todos = series.flatMap((s) => s.valores);
  const y0 = marcas(Math.min(...todos, reserva, 0), Math.max(...todos, reserva));
  const dominioMin = y0[0];
  const dominioMax = y0[y0.length - 1];
  const x = (d: number) => MARGEN.izquierda + (d / dias) * (ancho - MARGEN.izquierda - MARGEN.derecha);
  const y = (v: number) => MARGEN.arriba + (1 - (v - dominioMin) / (dominioMax - dominioMin)) * (alto - MARGEN.arriba - MARGEN.abajo);
  const linea = (valores: number[]) => valores.map((v, d) => `${d ? 'L' : 'M'}${x(d).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');

  const principal = series[0];
  const peor = minimo(principal.valores);
  const pasoFechas = ancho < 640 ? 10 : 5;
  const fechaDe = (d: number) => fechaCorta(sumarDias(hoy, d));

  function alMover(e: PointerEvent<HTMLDivElement>) {
    const caja = e.currentTarget.getBoundingClientRect();
    // El puntero llega en píxeles de pantalla: con la página a escala hay que convertirlo.
    const escala = caja.width / ancho;
    const relativo = (e.clientX - caja.left - MARGEN.izquierda * escala) / ((ancho - MARGEN.izquierda - MARGEN.derecha) * escala);
    setDia(Math.max(0, Math.min(dias, Math.round(relativo * dias))));
  }

  function alTeclear(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      setDia((d) => Math.max(0, Math.min(dias, (d ?? peor.d) + delta)));
    } else if (e.key === 'Escape') {
      setDia(null);
    }
  }

  const izquierdaTooltip = dia === null ? 0 : Math.max(0, Math.min(ancho - 190, x(dia) + (x(dia) > ancho / 2 ? -200 : 12)));

  return (
    <figure className="grafico">
      {series.length > 1 && (
        <ul className="grafico__leyenda">
          {series.map((s) => (
            <li key={s.nombre}>
              <svg width="28" height="10" aria-hidden="true">
                <line x1="0" x2="28" y1="5" y2="5" className={`grafico__linea ${s.clase}`} strokeDasharray={s.punteada ? '5 4' : undefined} />
              </svg>
              {s.nombre}
            </li>
          ))}
        </ul>
      )}
      <div
        ref={contenedor}
        className="grafico__lienzo"
        role="img"
        aria-label={`${titulo}. Peor día: ${fechaDe(peor.d)}, con ${fmt(peor.v)}. Usá las flechas para recorrer los días.`}
        tabIndex={0}
        onPointerMove={alMover}
        onPointerLeave={() => setDia(null)}
        onKeyDown={alTeclear}
        onBlur={() => setDia(null)}
      >
        <svg width={ancho} height={alto} aria-hidden="true">
          <defs>
            <linearGradient id={idDegrade} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--serie-1)" stopOpacity="0.18" />
              <stop offset="1" stopColor="var(--serie-1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {y0.map((v) => (
            <g key={v}>
              <line x1={MARGEN.izquierda} x2={ancho - MARGEN.derecha} y1={y(v)} y2={y(v)} className={v === 0 ? 'grafico__cero' : 'grafico__grilla'} />
              <text x={MARGEN.izquierda - 8} y={y(v) + 4} textAnchor="end" className="grafico__eje">
                {fmtCompacto(v)}
              </text>
            </g>
          ))}
          {Array.from({ length: Math.floor(dias / pasoFechas) + 1 }, (_, i) => i * pasoFechas).map((d) => (
            <text key={d} x={x(d)} y={alto - 8} textAnchor={d === 0 ? 'start' : d === dias ? 'end' : 'middle'} className="grafico__eje">
              {d === 0 ? 'Hoy' : `+${d} días`}
            </text>
          ))}
          {series.length === 1 && (
            <path d={`${linea(principal.valores)} L${x(dias)} ${y(dominioMin)} L${x(0)} ${y(dominioMin)} Z`} fill={`url(#${idDegrade})`} />
          )}
          <line x1={MARGEN.izquierda} x2={ancho - MARGEN.derecha} y1={y(reserva)} y2={y(reserva)} className="grafico__reserva" />
          <text x={ancho - MARGEN.derecha} y={y(reserva) - 6} textAnchor="end" className="grafico__etiqueta">
            Reserva
          </text>
          {[...series].reverse().map((s) => (
            <path key={s.nombre} d={linea(s.valores)} className={`grafico__linea ${s.clase}`} strokeDasharray={s.punteada ? '5 4' : undefined} />
          ))}
          <circle cx={x(peor.d)} cy={y(peor.v)} r={5} className="grafico__punto" />
          <text
            x={x(peor.d) + (x(peor.d) > ancho - 90 ? -10 : 10)}
            y={y(peor.v) + (y(peor.v) > alto - 60 ? -10 : 18)}
            textAnchor={x(peor.d) > ancho - 90 ? 'end' : 'start'}
            className="grafico__etiqueta"
          >
            Peor día
          </text>
          {dia !== null && (
            <g>
              <line x1={x(dia)} x2={x(dia)} y1={MARGEN.arriba} y2={alto - MARGEN.abajo} className="grafico__guia" />
              {series.map((s) => (
                <circle key={s.nombre} cx={x(dia)} cy={y(s.valores[dia])} r={4} className={`grafico__marca ${s.clase}`} />
              ))}
            </g>
          )}
        </svg>
        {dia !== null && (
          <div className="grafico__tooltip" style={{ left: izquierdaTooltip, top: 8 }}>
            <strong>{fechaDe(dia)}</strong>
            {series.map((s) => (
              <span key={s.nombre}>
                {series.length > 1 && <small>{s.nombre}: </small>}
                {fmt(s.valores[dia])}
              </span>
            ))}
          </div>
        )}
      </div>
      <details className="grafico__tabla">
        <summary>Ver día por día</summary>
        <div className="tabla-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Día</th>
                {series.map((s) => (
                  <th key={s.nombre} scope="col">
                    {series.length > 1 ? s.nombre : 'Caja estimada'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {principal.valores.map((_, d) => (
                <tr key={d}>
                  <td>{d === 0 ? 'Hoy' : fechaDe(d)}</td>
                  {series.map((s) => (
                    <td key={s.nombre}>{fmt(s.valores[d])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
