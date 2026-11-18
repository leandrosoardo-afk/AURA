import { useEffect, useRef, useState } from 'react';
import { FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { fmt, sumarDias } from '../shared/motor';
import type { Row } from 'write-excel-file/browser';
import { api, fechaDeHoy, type Yo } from './api';

type Rango = 'mes' | 'mesPasado' | 'trimestre' | 'anio' | 'elegido';

const RANGOS: [Rango, string][] = [
  ['mes', 'Este mes'],
  ['mesPasado', 'Mes pasado'],
  ['trimestre', 'Últimos 3 meses'],
  ['anio', 'Este año'],
  ['elegido', 'Elegir fechas'],
];

interface Informe {
  generado: string;
  periodo: { desde: string; hasta: string };
  espacio: string;
  titular: string;
  movimientos: {
    lista: { tipo: 'ingreso' | 'egreso'; monto: number; concepto: string; categoria: string; fecha: string; programado: boolean }[];
    recortado: boolean;
    totales: { ingresos: number; egresos: number; neto: number; cantidad: number };
    categorias: { tipo: 'ingreso' | 'egreso'; categoria: string; total: number; cantidad: number }[];
  };
  caja: {
    saldo: number;
    reserva: number;
    ventaDiaria: number;
    gastoDiario: number;
    minimo: { dia: number; saldo: number };
    nivel: 'verde' | 'amarillo' | 'rojo' | 'gris';
    frase: string;
    dias: { dia: number; saldo: number }[];
  } | null;
  futuros: {
    lista: { tipo: 'pago' | 'cobro'; monto: number; concepto: string; categoria: string; fecha: string; mensual: boolean; origen: 'agenda' | 'movimiento' }[];
    pagos: number;
    cobros: number;
  };
}

function finDeMes(inicio: string): string {
  return sumarDias(`${sumarDias(inicio, 32).slice(0, 8)}01`, -1);
}

function fechasDe(rango: Rango, hoy: string): { desde: string; hasta: string } {
  const inicioMes = `${hoy.slice(0, 8)}01`;
  switch (rango) {
    case 'mesPasado': {
      const inicio = `${sumarDias(inicioMes, -1).slice(0, 8)}01`;
      return { desde: inicio, hasta: finDeMes(inicio) };
    }
    case 'trimestre':
      return { desde: sumarDias(hoy, -89), hasta: hoy };
    case 'anio':
      return { desde: `${hoy.slice(0, 4)}-01-01`, hasta: `${hoy.slice(0, 4)}-12-31` };
    default:
      return { desde: inicioMes, hasta: finDeMes(inicioMes) };
  }
}

/** 2026-11-04 → 04/11/2026 */
const fechaLarga = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
const comoFecha = (f: string) => new Date(`${f}T12:00:00`);

const NIVEL: Record<string, string> = { verde: 'En verde', amarillo: 'Con cuidado', rojo: 'En rojo', gris: 'Sin datos suficientes' };

export function Informes({ yo, espacioId }: { yo: Yo; espacioId: string }) {
  const hoy = fechaDeHoy();
  const persona = yo.usuario.tipo === 'persona';
  const nombreCaja = persona ? 'Tu plata a 30 días' : 'Caja a 30 días';

  const [rango, setRango] = useState<Rango>('mes');
  const [desdeElegido, setDesdeElegido] = useState(`${hoy.slice(0, 8)}01`);
  const [hastaElegido, setHastaElegido] = useState(hoy);
  const [incluir, setIncluir] = useState({ movimientos: true, caja: true, futuros: true });
  const [informe, setInforme] = useState<Informe | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const ultimoPedido = useRef(0);

  const { desde, hasta } = rango === 'elegido' ? { desde: desdeElegido, hasta: hastaElegido } : fechasDe(rango, hoy);
  const fechasInvalidas = !desde || !hasta || desde > hasta;
  const nada = !incluir.movimientos && !incluir.caja && !incluir.futuros;

  useEffect(() => {
    if (fechasInvalidas) return;
    const pedido = ++ultimoPedido.current;
    setCargando(true);
    api<Informe>(`/espacios/${espacioId}/informe?desde=${desde}&hasta=${hasta}`)
      .then((r) => {
        if (pedido !== ultimoPedido.current) return;
        setInforme(r);
        setError(null);
      })
      .catch((err) => {
        if (pedido === ultimoPedido.current) setError((err as Error).message);
      })
      .finally(() => {
        if (pedido === ultimoPedido.current) setCargando(false);
      });
  }, [espacioId, desde, hasta, fechasInvalidas]);

  async function descargarExcel() {
    if (!informe) return;
    setExportando(true);
    try {
      const { default: escribirExcel } = await import('write-excel-file/browser');
      const titulo = (valor: string) => ({ value: valor, fontWeight: 'bold' as const });
      const pesos = (valor: number) => ({ value: valor, type: Number, format: '#,##0' });
      const fecha = (valor: string) => ({ value: comoFecha(valor), type: Date, format: 'dd/mm/yyyy' });

      const hojas = [];
      const resumen: Row[] = [
        [titulo(`Informe de ${informe.espacio}`)],
        ['Titular', informe.titular],
        ['Período', `${fechaLarga(informe.periodo.desde)} al ${fechaLarga(informe.periodo.hasta)}`],
        ['Generado', fechaLarga(informe.generado)],
        [],
      ];
      if (incluir.movimientos) {
        const t = informe.movimientos.totales;
        resumen.push([titulo('Movimientos del período')], ['Entró', pesos(t.ingresos)], ['Salió', pesos(t.egresos)], ['Resultado', pesos(t.neto)], ['Cantidad de movimientos', t.cantidad], []);
      }
      if (incluir.caja && informe.caja) {
        const c = informe.caja;
        resumen.push(
          [titulo(nombreCaja)],
          ['Saldo de hoy', pesos(c.saldo)],
          ['Saldo más bajo', pesos(c.minimo.saldo)],
          ['Día del saldo más bajo', fecha(sumarDias(informe.generado, c.minimo.dia))],
          ['Reserva elegida', pesos(c.reserva)],
          ['Estado', NIVEL[c.nivel] ?? c.nivel],
          ['Lectura', c.frase],
          [],
        );
      }
      if (incluir.futuros) {
        resumen.push([titulo('Pagos y cobros futuros')], ['Pagos por venir', pesos(informe.futuros.pagos)], ['Cobros por venir', pesos(informe.futuros.cobros)]);
      }
      hojas.push({ sheet: 'Resumen', data: resumen, columns: [{ width: 26 }, { width: 60 }] });

      if (incluir.movimientos) {
        hojas.push({
          sheet: 'Movimientos',
          columns: [{ width: 12 }, { width: 40 }, { width: 22 }, { width: 10 }, { width: 14 }, { width: 12 }],
          data: [
            ['Fecha', 'Concepto', 'Categoría', 'Tipo', 'Monto', 'Estado'].map(titulo),
            ...informe.movimientos.lista.map((m) => [fecha(m.fecha), m.concepto, m.categoria, m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto', pesos(m.monto), m.programado ? 'Programado' : 'Registrado']),
          ],
        });
        hojas.push({
          sheet: 'Por categoría',
          columns: [{ width: 10 }, { width: 26 }, { width: 14 }, { width: 12 }],
          data: [['Tipo', 'Categoría', 'Total', 'Cantidad'].map(titulo), ...informe.movimientos.categorias.map((c) => [c.tipo === 'ingreso' ? 'Ingreso' : 'Gasto', c.categoria, pesos(c.total), c.cantidad])],
        });
      }
      if (incluir.caja && informe.caja) {
        hojas.push({
          sheet: persona ? 'Tu plata 30 días' : 'Caja 30 días',
          columns: [{ width: 12 }, { width: 16 }],
          data: [['Fecha', 'Saldo estimado'].map(titulo), ...informe.caja.dias.map((d) => [fecha(sumarDias(informe.generado, d.dia)), pesos(d.saldo)])],
        });
      }
      if (incluir.futuros) {
        hojas.push({
          sheet: 'Pagos y cobros futuros',
          columns: [{ width: 12 }, { width: 40 }, { width: 22 }, { width: 10 }, { width: 14 }, { width: 18 }],
          data: [
            ['Fecha', 'Concepto', 'Categoría', 'Tipo', 'Monto', 'Detalle'].map(titulo),
            ...informe.futuros.lista.map((f) => [fecha(f.fecha), f.concepto, f.categoria, f.tipo === 'pago' ? 'Pago' : 'Cobro', pesos(f.monto), f.origen === 'movimiento' ? 'Programado' : f.mensual ? 'Agendado, mensual' : 'Agendado']),
          ],
        });
      }
      await escribirExcel(hojas).toFile(`AURA_informe_${informe.periodo.desde}_al_${informe.periodo.hasta}.xlsx`);
    } catch {
      setError('No pudimos armar el Excel. Probá de nuevo.');
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="pantalla informes">
      <h1 className="titulo-pantalla">Informes</h1>

      <section className="card panel informe-controles" aria-label="Armar el informe">
        <p className="contador">Elegí el período y qué incluir. Lo descargás en PDF para leerlo o mandarlo, o en Excel para tu contador.</p>
        <div className="filtros__chips" role="group" aria-label="Período">
          {RANGOS.map(([r, nombre]) => (
            <button key={r} type="button" className={`chip${rango === r ? ' chip--elegido' : ''}`} aria-pressed={rango === r} onClick={() => setRango(r)}>
              {nombre}
            </button>
          ))}
        </div>
        {rango === 'elegido' && (
          <div className="filtros__fechas">
            <label className="campo">
              Desde
              <input type="date" value={desdeElegido} max={hastaElegido || undefined} onChange={(e) => setDesdeElegido(e.target.value)} />
            </label>
            <label className="campo">
              Hasta
              <input type="date" value={hastaElegido} min={desdeElegido || undefined} onChange={(e) => setHastaElegido(e.target.value)} />
            </label>
          </div>
        )}
        <fieldset className="informe-incluir">
          <legend>Incluir</legend>
          <label className="casilla">
            <input type="checkbox" checked={incluir.movimientos} onChange={(e) => setIncluir({ ...incluir, movimientos: e.target.checked })} />
            Movimientos del período
          </label>
          <label className="casilla">
            <input type="checkbox" checked={incluir.caja} onChange={(e) => setIncluir({ ...incluir, caja: e.target.checked })} />
            {nombreCaja}
          </label>
          <label className="casilla">
            <input type="checkbox" checked={incluir.futuros} onChange={(e) => setIncluir({ ...incluir, futuros: e.target.checked })} />
            Pagos y cobros futuros
          </label>
        </fieldset>
        {fechasInvalidas && (
          <p className="error" role="alert">
            La fecha desde tiene que ser anterior a la fecha hasta.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="informe-botones">
          <button type="button" className="boton boton--principal boton--icono" disabled={!informe || cargando || nada || fechasInvalidas} onClick={() => window.print()}>
            <Printer size={18} aria-hidden="true" /> Descargar PDF
          </button>
          <button type="button" className="boton boton--secundario boton--icono" disabled={!informe || cargando || nada || fechasInvalidas || exportando} onClick={descargarExcel}>
            <FileSpreadsheet size={18} aria-hidden="true" /> {exportando ? 'Armando…' : 'Descargar Excel'}
          </button>
        </div>
        <small className="contador">Para el PDF se abre la ventana de impresión: elegí "Guardar como PDF".</small>
      </section>

      {nada ? (
        <div className="vacio">
          <FileText size={32} strokeWidth={1.5} aria-hidden="true" />
          <p>Elegí al menos una parte para armar el informe.</p>
        </div>
      ) : (
        informe && (
          <article className="card informe" aria-busy={cargando} aria-label="Vista previa del informe">
            <header className="informe__cabecera">
              <img src="/logo-aura.png" alt="" width={40} height={40} />
              <div>
                <h2>Informe de {informe.espacio}</h2>
                <p>
                  {informe.titular} · Del {fechaLarga(informe.periodo.desde)} al {fechaLarga(informe.periodo.hasta)} · Generado el {fechaLarga(informe.generado)}
                </p>
              </div>
            </header>

            {incluir.movimientos && (
              <section className="informe__seccion">
                <h3>Movimientos del período</h3>
                <dl className="informe__totales">
                  <div>
                    <dt>Entró</dt>
                    <dd className="monto--ingreso">{fmt(informe.movimientos.totales.ingresos)}</dd>
                  </div>
                  <div>
                    <dt>Salió</dt>
                    <dd>{fmt(informe.movimientos.totales.egresos)}</dd>
                  </div>
                  <div>
                    <dt>Resultado</dt>
                    <dd className={informe.movimientos.totales.neto >= 0 ? 'monto--ingreso' : 'informe__negativo'}>{fmt(informe.movimientos.totales.neto)}</dd>
                  </div>
                  <div>
                    <dt>Movimientos</dt>
                    <dd>{informe.movimientos.totales.cantidad}</dd>
                  </div>
                </dl>
                {informe.movimientos.lista.length === 0 ? (
                  <p className="contador">No hay movimientos en este período.</p>
                ) : (
                  <>
                    <h4>Por categoría</h4>
                    <div className="tabla-scroll">
                      <table className="informe__tabla">
                        <thead>
                          <tr>
                            <th scope="col">Tipo</th>
                            <th scope="col">Categoría</th>
                            <th scope="col">Cantidad</th>
                            <th scope="col">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {informe.movimientos.categorias.map((c) => (
                            <tr key={`${c.tipo}${c.categoria}`}>
                              <td>{c.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'}</td>
                              <td>{c.categoria}</td>
                              <td>{c.cantidad}</td>
                              <td>{fmt(c.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <h4>Detalle</h4>
                    <div className="tabla-scroll">
                      <table className="informe__tabla">
                        <thead>
                          <tr>
                            <th scope="col">Fecha</th>
                            <th scope="col">Concepto</th>
                            <th scope="col">Categoría</th>
                            <th scope="col">Monto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {informe.movimientos.lista.map((m, i) => (
                            <tr key={i}>
                              <td>
                                {fechaLarga(m.fecha)}
                                {m.programado && <small> (programado)</small>}
                              </td>
                              <td>{m.concepto}</td>
                              <td>{m.categoria}</td>
                              <td className={m.tipo === 'ingreso' ? 'monto--ingreso' : undefined}>
                                {m.tipo === 'ingreso' ? '+' : '−'}
                                {fmt(m.monto)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {informe.movimientos.recortado && <p className="contador">El detalle muestra los primeros 5000 movimientos. Achicá el período para ver el resto.</p>}
                  </>
                )}
              </section>
            )}

            {incluir.caja && (
              <section className="informe__seccion">
                <h3>{nombreCaja}</h3>
                {informe.caja ? (
                  <>
                    <p className="informe__frase">{informe.caja.frase}</p>
                    <dl className="informe__totales">
                      <div>
                        <dt>Saldo de hoy</dt>
                        <dd>{fmt(informe.caja.saldo)}</dd>
                      </div>
                      <div>
                        <dt>Saldo más bajo</dt>
                        <dd className={informe.caja.minimo.saldo < 0 ? 'informe__negativo' : undefined}>{fmt(informe.caja.minimo.saldo)}</dd>
                      </div>
                      <div>
                        <dt>Ese día</dt>
                        <dd>{fechaLarga(sumarDias(informe.generado, informe.caja.minimo.dia))}</dd>
                      </div>
                      <div>
                        <dt>Estado</dt>
                        <dd>{NIVEL[informe.caja.nivel] ?? informe.caja.nivel}</dd>
                      </div>
                    </dl>
                    <h4>Saldo estimado día por día</h4>
                    <div className="tabla-scroll">
                      <table className="informe__tabla informe__tabla--dias">
                        <thead>
                          <tr>
                            <th scope="col">Fecha</th>
                            <th scope="col">Saldo estimado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {informe.caja.dias.map((d) => (
                            <tr key={d.dia}>
                              <td>{d.dia === 0 ? 'Hoy' : fechaLarga(sumarDias(informe.generado, d.dia))}</td>
                              <td className={d.saldo < 0 ? 'informe__negativo' : undefined}>{fmt(d.saldo)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="contador">
                      Calculado con lo que entra ({fmt(informe.caja.ventaDiaria)} por día) y lo que gastás ({fmt(informe.caja.gastoDiario)} por día) en promedio, más los pagos y cobros agendados.
                    </p>
                  </>
                ) : (
                  <p className="contador">Todavía no hay datos suficientes para proyectar. Registrá movimientos o importá tu Excel.</p>
                )}
              </section>
            )}

            {incluir.futuros && (
              <section className="informe__seccion">
                <h3>Pagos y cobros futuros</h3>
                <dl className="informe__totales">
                  <div>
                    <dt>Pagos por venir</dt>
                    <dd>{fmt(informe.futuros.pagos)}</dd>
                  </div>
                  <div>
                    <dt>Cobros por venir</dt>
                    <dd className="monto--ingreso">{fmt(informe.futuros.cobros)}</dd>
                  </div>
                </dl>
                {informe.futuros.lista.length === 0 ? (
                  <p className="contador">No hay pagos ni cobros agendados.</p>
                ) : (
                  <div className="tabla-scroll">
                    <table className="informe__tabla">
                      <thead>
                        <tr>
                          <th scope="col">Fecha</th>
                          <th scope="col">Concepto</th>
                          <th scope="col">Categoría</th>
                          <th scope="col">Monto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {informe.futuros.lista.map((f, i) => (
                          <tr key={i}>
                            <td>
                              {fechaLarga(f.fecha)}
                              {f.fecha < hoy && <small> (vencido)</small>}
                            </td>
                            <td>
                              {f.concepto}
                              {f.mensual && <small> (mensual)</small>}
                            </td>
                            <td>{f.categoria}</td>
                            <td className={f.tipo === 'cobro' ? 'monto--ingreso' : undefined}>
                              {f.tipo === 'cobro' ? '+' : '−'}
                              {fmt(f.monto)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
            <footer className="informe__pie">Hecho con AURA. Los saldos futuros son estimaciones, no garantías.</footer>
          </article>
        )
      )}
    </div>
  );
}
