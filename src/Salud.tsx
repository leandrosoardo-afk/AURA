import { useEffect, useState } from 'react';
import { fmt } from '../shared/motor';
import type { MesHistorial, Salud } from '../shared/salud';
import { api } from './api';
import { arcoSemi, EstadoNivel, puntoEnArco } from './comunes';

export interface RespuestaSalud {
  salud: Salud;
  historial: MesHistorial[];
}

/** `version` cambia cada vez que se registran datos, para volver a calcular. */
export function useSalud(espacioId: string, version = 0) {
  const [datos, setDatos] = useState<RespuestaSalud | null>(null);
  useEffect(() => {
    api<RespuestaSalud>(`/espacios/${espacioId}/salud`)
      .then(setDatos)
      .catch(() => setDatos(null));
  }, [espacioId, version]);
  return datos;
}

const NOMBRE_MES = (mes: string) => {
  const [anio, numero] = mes.split('-').map(Number);
  return new Date(Date.UTC(anio, numero - 1, 1)).toLocaleDateString('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace('.', '');
};

/** Medidor de 0 a 100 con las mismas zonas que el puntaje: rojo, amarillo y verde. */
export function TarjetaSalud({ salud }: { salud: Salud }) {
  const conPuntaje = salud.puntaje !== null;
  const marca = puntoEnArco((salud.puntaje ?? 0) / 100, 84);
  return (
    <section className="salud card" aria-labelledby="titulo-salud">
      <figure className="medidor salud__medidor">
        <svg viewBox="0 0 200 112" role="img" aria-label={conPuntaje ? `Salud financiera: ${salud.puntaje} de 100` : 'Salud financiera sin datos suficientes'}>
          <path d={arcoSemi(0, 0.39)} className={`medidor__zona medidor__zona--rojo${conPuntaje ? '' : ' medidor__zona--apagada'}`} />
          <path d={arcoSemi(0.41, 0.69)} className={`medidor__zona medidor__zona--amarillo${conPuntaje ? '' : ' medidor__zona--apagada'}`} />
          <path d={arcoSemi(0.71, 1)} className={`medidor__zona medidor__zona--verde${conPuntaje ? '' : ' medidor__zona--apagada'}`} />
          {conPuntaje && <circle cx={marca.x} cy={marca.y} r="8" className="medidor__marca" />}
          <text x="100" y="92" textAnchor="middle" className="medidor__valor">
            {salud.puntaje ?? '–'}
          </text>
        </svg>
        <figcaption>de 100</figcaption>
      </figure>
      <div className="salud__texto">
        <h2 id="titulo-salud">Salud financiera</h2>
        <EstadoNivel nivel={salud.nivel} />
        <p className="salud__titulo">{salud.titulo}</p>
        <p className="salud__detalle">{salud.detalle}</p>
        {salud.componentes.length > 0 && (
          <ul className="salud__componentes">
            {salud.componentes.map((c) => (
              <li key={c.id} title={c.detalle}>
                <span>{c.nombre}</span>
                <span className="salud__barra" aria-hidden="true">
                  <i style={{ width: `${c.puntaje}%` }} />
                </span>
                <span className="salud__valor">{c.puntaje}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="contador">Es una orientación con tus datos cargados, no una calificación crediticia.</p>
      </div>
    </section>
  );
}

/** Se arma solo con los movimientos: no hay nada para cargar aparte. */
export function Historial({ historial }: { historial: MesHistorial[] }) {
  if (historial.length === 0) {
    return (
      <section className="bloque">
        <h2>Historial</h2>
        <p className="contador">Se arma solo cuando registres o importes movimientos.</p>
      </section>
    );
  }
  const conPuntaje = historial.filter((m) => m.puntaje !== null).slice(0, 12).reverse();
  return (
    <section className="bloque">
      <h2>Historial</h2>
      <p className="contador">Se registra solo con tus movimientos, también con los importados.</p>
      {conPuntaje.length > 1 && (
        <figure className="barras" aria-label="Salud financiera al cierre de cada mes">
          <figcaption>Salud financiera al cierre de cada mes</figcaption>
          <div className="barras__lienzo">
            {conPuntaje.map((m) => (
              <div key={m.mes} className="barras__columna" title={`${NOMBRE_MES(m.mes)}: ${m.puntaje} de 100`}>
                <span className="barras__valor">{m.puntaje}</span>
                <span className="barras__barra" style={{ height: `${Math.max(m.puntaje ?? 0, 2)}%` }} />
                <span className="barras__mes">{NOMBRE_MES(m.mes)}</span>
              </div>
            ))}
          </div>
        </figure>
      )}
      <div className="tabla-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Mes</th>
              <th scope="col">Entró</th>
              <th scope="col">Salió</th>
              <th scope="col">Resultado</th>
              <th scope="col">Saldo al cierre</th>
              <th scope="col">Peor saldo</th>
              <th scope="col">Salud</th>
            </tr>
          </thead>
          <tbody>
            {historial.map((m) => (
              <tr key={m.mes}>
                <td>{NOMBRE_MES(m.mes)}</td>
                <td>{fmt(m.ingresos)}</td>
                <td>{fmt(m.egresos)}</td>
                <td>{fmt(m.resultado)}</td>
                <td>{fmt(m.saldoCierre)}</td>
                <td>{fmt(m.saldoMinimo)}</td>
                <td>{m.puntaje ?? 'Sin datos'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
