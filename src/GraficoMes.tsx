import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fmt, fmtCompacto } from '../shared/motor';
import type { Resumen } from './api';
import { marcas } from './Grafico';

const MARGEN = { arriba: 16, derecha: 96, abajo: 28, izquierda: 60 };

const NOMBRE_MES = (fecha: string) => new Date(`${fecha}T00:00:00Z`).toLocaleDateString('es-AR', { month: 'long', timeZone: 'UTC' });

/**
 * Lo que entró y lo que salió en el mes, acumulado día por día hasta hoy.
 * Los egresos van en rojo, como pidió el grupo, para que se distingan de un vistazo.
 */
export function GraficoMes({ resumen }: { resumen: Resumen }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(640);
  const [dia, setDia] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = contenedor.current;
    if (!el) return;
    // clientWidth no cambia con el zoom de la página; getBoundingClientRect sí.
    setAncho(el.clientWidth);
    const observador = new ResizeObserver(([entrada]) => setAncho(entrada.contentRect.width));
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  const [anio, mes, diaHoy] = resumen.hoy.split('-').map(Number);
  const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const porDia = new Map(resumen.diasMes.map((d) => [Number(d.fecha.slice(8)), d]));

  // Acumulados del día 1 a hoy. La posición 0 es el día 1.
  const ingresos: number[] = [];
  const egresos: number[] = [];
  for (let d = 1; d <= diaHoy; d++) {
    ingresos.push((ingresos.at(-1) ?? 0) + (porDia.get(d)?.ingresos ?? 0));
    egresos.push((egresos.at(-1) ?? 0) + (porDia.get(d)?.egresos ?? 0));
  }
  const tope = Math.max(...ingresos, ...egresos, 1);
  const y0 = marcas(0, tope);
  const maximo = y0[y0.length - 1];

  const alto = ancho < 480 ? 220 : 260;
  const x = (i: number) => MARGEN.izquierda + (i / Math.max(diasDelMes - 1, 1)) * (ancho - MARGEN.izquierda - MARGEN.derecha);
  const y = (v: number) => MARGEN.arriba + (1 - v / maximo) * (alto - MARGEN.arriba - MARGEN.abajo);
  const linea = (valores: number[]) => valores.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const fechaDe = (i: number) => `${i + 1}/${mes}`;
  const ultimo = diaHoy - 1;

  function alMover(e: PointerEvent<HTMLDivElement>) {
    const caja = e.currentTarget.getBoundingClientRect();
    // El puntero llega en píxeles de pantalla: con la página a escala hay que convertirlo.
    const escala = caja.width / ancho;
    const relativo = (e.clientX - caja.left - MARGEN.izquierda * escala) / ((ancho - MARGEN.izquierda - MARGEN.derecha) * escala);
    setDia(Math.max(0, Math.min(ultimo, Math.round(relativo * (diasDelMes - 1)))));
  }

  function alTeclear(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      setDia((d) => Math.max(0, Math.min(ultimo, (d ?? ultimo) + delta)));
    } else if (e.key === 'Escape') {
      setDia(null);
    }
  }

  const izquierdaTooltip = dia === null ? 0 : Math.max(0, Math.min(ancho - 190, x(dia) + (x(dia) > ancho / 2 ? -200 : 12)));
  // Etiquetas al final de cada línea; si quedan muy juntas, se separan.
  const yIngreso = y(ingresos[ultimo]);
  let yEgreso = y(egresos[ultimo]);
  if (Math.abs(yEgreso - yIngreso) < 16) yEgreso = yIngreso + (yEgreso >= yIngreso ? 16 : -16);
  const pasoFechas = ancho < 640 ? 10 : 5;

  return (
    <section className="card panel">
      <div className="panel__cabecera">
        <h2>Ingresos y egresos de {NOMBRE_MES(resumen.hoy)}</h2>
        <ul className="grafico__leyenda grafico__leyenda--totales">
          <li>
            <svg width="20" height="10" aria-hidden="true">
              <line x1="0" x2="20" y1="5" y2="5" className="grafico__linea serie-1" />
            </svg>
            Entró {fmt(resumen.ingresosMes)}
          </li>
          <li>
            <svg width="20" height="10" aria-hidden="true">
              <line x1="0" x2="20" y1="5" y2="5" className="grafico__linea serie-egresos" />
            </svg>
            Salió {fmt(resumen.egresosMes)}
          </li>
        </ul>
      </div>
      {resumen.diasMes.length === 0 ? (
        <p className="contador">Todavía no hay movimientos este mes. Cuando registres ingresos o gastos los vas a ver acá.</p>
      ) : (
        <figure className="grafico">
          <div
            ref={contenedor}
            className="grafico__lienzo"
            role="img"
            aria-label={`Ingresos y egresos acumulados del mes. Hasta hoy entraron ${fmt(resumen.ingresosMes)} y salieron ${fmt(resumen.egresosMes)}. Usá las flechas para recorrer los días.`}
            tabIndex={0}
            onPointerMove={alMover}
            onPointerLeave={() => setDia(null)}
            onKeyDown={alTeclear}
            onBlur={() => setDia(null)}
          >
            <svg width={ancho} height={alto} aria-hidden="true">
              {y0.map((v) => (
                <g key={v}>
                  <line x1={MARGEN.izquierda} x2={ancho - MARGEN.derecha} y1={y(v)} y2={y(v)} className={v === 0 ? 'grafico__cero' : 'grafico__grilla'} />
                  <text x={MARGEN.izquierda - 8} y={y(v) + 4} textAnchor="end" className="grafico__eje">
                    {fmtCompacto(v)}
                  </text>
                </g>
              ))}
              {[0, ...Array.from({ length: Math.floor((diasDelMes - 1) / pasoFechas) }, (_, i) => (i + 1) * pasoFechas - 1)].map((i) => (
                <text key={i} x={x(i)} y={alto - 8} textAnchor={i === 0 ? 'start' : 'middle'} className="grafico__eje">
                  {fechaDe(i)}
                </text>
              ))}
              <path d={linea(ingresos)} className="grafico__linea serie-1" />
              <path d={linea(egresos)} className="grafico__linea serie-egresos" />
              <circle cx={x(ultimo)} cy={y(ingresos[ultimo])} r={4} className="grafico__marca serie-1" />
              <circle cx={x(ultimo)} cy={y(egresos[ultimo])} r={4} className="grafico__marca serie-egresos" />
              <text x={x(ultimo) + 8} y={yIngreso + 4} className="grafico__etiqueta">
                Ingresos
              </text>
              <text x={x(ultimo) + 8} y={yEgreso + 4} className="grafico__etiqueta grafico__etiqueta--egresos">
                Egresos
              </text>
              {dia !== null && (
                <g>
                  <line x1={x(dia)} x2={x(dia)} y1={MARGEN.arriba} y2={alto - MARGEN.abajo} className="grafico__guia" />
                  <circle cx={x(dia)} cy={y(ingresos[dia])} r={4} className="grafico__marca serie-1" />
                  <circle cx={x(dia)} cy={y(egresos[dia])} r={4} className="grafico__marca serie-egresos" />
                </g>
              )}
            </svg>
            {dia !== null && (
              <div className="grafico__tooltip" style={{ left: izquierdaTooltip, top: 8 }}>
                <strong>Hasta el {fechaDe(dia)}</strong>
                <span>
                  <small>Entró: </small>
                  {fmt(ingresos[dia])}
                </span>
                <span>
                  <small>Salió: </small>
                  {fmt(egresos[dia])}
                </span>
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
                    <th scope="col">Entró</th>
                    <th scope="col">Salió</th>
                    <th scope="col">Entró en el mes</th>
                    <th scope="col">Salió en el mes</th>
                  </tr>
                </thead>
                <tbody>
                  {ingresos.map((_, i) => (
                    <tr key={i}>
                      <td>{fechaDe(i)}</td>
                      <td>{fmt(porDia.get(i + 1)?.ingresos ?? 0)}</td>
                      <td>{fmt(porDia.get(i + 1)?.egresos ?? 0)}</td>
                      <td>{fmt(ingresos[i])}</td>
                      <td>{fmt(egresos[i])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </figure>
      )}
    </section>
  );
}
