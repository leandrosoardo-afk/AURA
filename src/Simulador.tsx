import { useState, type FormEvent } from 'react';
import { fmt, OPCIONES_CUOTAS, type EntradaSimulador, type Nivel, type ResultadoSimulador } from '../shared/motor';
import { api, ErrorApi } from './api';
import type { Navegar } from './App';
import { arcoSemi, CampoPesos, digitos, EstadoNivel, puntoEnArco } from './comunes';
import { Grafico } from './Grafico';

type Resultado = ResultadoSimulador & { hoy: string; reserva: number };

const ESCALA_MAX = 0.6; // El medidor llega hasta el 60% de lo que queda por mes.

function Medidor({ proporcion, nivel }: { proporcion: number | null; nivel: Nivel }) {
  const fraccion = proporcion === null ? 1 : Math.min(proporcion / ESCALA_MAX, 1);
  const marca = puntoEnArco(fraccion, 84);
  return (
    <figure className="medidor">
      <svg viewBox="0 0 200 112" role="img" aria-label={proporcion === null ? 'Sin margen para medir la cuota' : `La cuota es el ${Math.round(proporcion * 100)}% de lo que te queda por mes`}>
        <path d={arcoSemi(0, 0.49)} className="medidor__zona medidor__zona--verde" />
        <path d={arcoSemi(0.51, 0.656)} className="medidor__zona medidor__zona--amarillo" />
        <path d={arcoSemi(0.677, 1)} className="medidor__zona medidor__zona--rojo" />
        <circle cx={marca.x} cy={marca.y} r="8" className={`medidor__marca medidor__marca--${nivel}`} />
        <text x="100" y="92" textAnchor="middle" className="medidor__valor">
          {proporcion === null ? 'Sin margen' : `${Math.round(proporcion * 100)}%`}
        </text>
      </svg>
      <figcaption>de lo que te queda por mes. Hasta 30% es seguro.</figcaption>
    </figure>
  );
}

export function Simulador({ espacioId, navegar }: { espacioId: string; navegar: Navegar }) {
  const [concepto, setConcepto] = useState('');
  const [precio, setPrecio] = useState('');
  const [anticipo, setAnticipo] = useState('');
  const [diaAnticipo, setDiaAnticipo] = useState('1');
  const [cuotas, setCuotas] = useState(12);
  const [tna, setTna] = useState('');
  const [diaCuota, setDiaCuota] = useState('30');
  const [simulada, setSimulada] = useState<{ entrada: EntradaSimulador; concepto: string; resultado: Resultado } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [faltanDatos, setFaltanDatos] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [confirmarRojo, setConfirmarRojo] = useState(false);
  const [guardadas, setGuardadas] = useState<number | null>(null);

  async function correr(cantidad: number) {
    setError(null);
    setFaltanDatos(false);
    setConfirmarRojo(false);
    setGuardadas(null);
    const tasa = Number(tna.replace(',', '.'));
    if (tna.trim() === '' || Number.isNaN(tasa)) {
      setError('Escribí la tasa anual. Si es sin interés, poné 0.');
      return;
    }
    const entrada: EntradaSimulador = {
      precio: digitos(precio),
      anticipo: digitos(anticipo),
      diaAnticipo: Number(diaAnticipo) || 1,
      cuotas: cantidad,
      tna: tasa,
      diaCuota: Number(diaCuota) || 30,
    };
    setEnviando(true);
    try {
      const resultado = await api<Resultado>(`/espacios/${espacioId}/simulador`, { metodo: 'POST', cuerpo: entrada });
      // Se guarda lo que se simuló, aunque después cambien los campos del formulario.
      setSimulada({ entrada, concepto, resultado });
      setCuotas(cantidad);
    } catch (err) {
      setSimulada(null);
      if (err instanceof ErrorApi && err.codigo === 'sin_parametros') setFaltanDatos(true);
      else setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function guardar(confirmado: boolean) {
    if (!simulada) return;
    if (simulada.resultado.nivel === 'rojo' && !confirmado) {
      setConfirmarRojo(true);
      return;
    }
    setError(null);
    setEnviando(true);
    try {
      const r = await api<{ creados: number }>(`/espacios/${espacioId}/simulador/guardar`, {
        metodo: 'POST',
        cuerpo: { ...simulada.entrada, concepto: simulada.concepto, confirmarRojo: confirmado },
      });
      setGuardadas(r.creados);
      setConfirmarRojo(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    void correr(cuotas);
  }

  const r = simulada?.resultado;

  return (
    <div className="pantalla movimientos">
      <h1 className="titulo-pantalla">Simulador</h1>

      <form className="registro" onSubmit={enviar}>
        <label className="campo">
          ¿Qué querés comprar?
          <input required maxLength={100} placeholder="Un horno, un crédito, un adelanto" value={concepto} onChange={(e) => setConcepto(e.target.value)} />
        </label>
        <CampoPesos etiqueta="Precio total" valor={precio} alCambiar={setPrecio} />
        <CampoPesos etiqueta="Anticipo" valor={anticipo} alCambiar={setAnticipo} requerido={false} ayuda="Si no ponés anticipo, se financia todo." />
        {digitos(anticipo) > 0 && (
          <label className="campo">
            ¿En cuántos días pagás el anticipo?
            <input type="number" min={1} max={365} required value={diaAnticipo} onChange={(e) => setDiaAnticipo(e.target.value)} />
          </label>
        )}
        <fieldset className="categorias">
          <legend>Cuotas</legend>
          <div className="segmentado segmentado--cuotas" role="group" aria-label="Cantidad de cuotas">
            {OPCIONES_CUOTAS.map((n) => (
              <button key={n} type="button" aria-pressed={cuotas === n} onClick={() => setCuotas(n)}>
                {n}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="campo">
          Tasa anual (TNA, en %)
          <input inputMode="decimal" required value={tna} onChange={(e) => setTna(e.target.value)} />
          <small>Si es sin interés, poné 0.</small>
        </label>
        <label className="campo">
          ¿En cuántos días pagás la primera cuota?
          <input type="number" min={1} max={90} required value={diaCuota} onChange={(e) => setDiaCuota(e.target.value)} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="boton boton--principal" disabled={enviando}>
          {enviando ? 'Calculando…' : 'Simular'}
        </button>
      </form>

      <div className="lista">
        {faltanDatos && (
          <div className="vacio">
            <p>Para saber si te conviene necesitamos tus movimientos: con ellos calculamos lo que entra y lo que gastás.</p>
            <button className="boton boton--principal" onClick={() => navegar('/movimientos')}>
              Ir a Movimientos
            </button>
          </div>
        )}
        {!r && !faltanDatos && (
          <div className="vacio">
            <p>Simulá antes de comprometerte: nada de esto se guarda hasta que lo decidas.</p>
          </div>
        )}
        {r && simulada && (
          <>
            <section className={`estado estado--${r.nivel}`}>
              <EstadoNivel nivel={r.nivel} />
              <p className="estado__frase">
                {simulada.entrada.cuotas} cuotas de {fmt(r.cuota)}
              </p>
              <ul className="estado__razones">
                {r.razones.map((razon) => (
                  <li key={razon}>{razon}</li>
                ))}
              </ul>
              {r.alternativa && <p className="estado__alternativa">{r.alternativa}</p>}
            </section>

            <Medidor proporcion={r.proporcion} nivel={r.nivel} />

            <dl className="cifras">
              <div>
                <dt>Pagás en total</dt>
                <dd>{fmt(r.total)}</dd>
              </div>
              <div>
                <dt>De intereses</dt>
                <dd>{fmt(r.intereses)}</dd>
              </div>
            </dl>

            <Grafico
              titulo={`Caja a 30 días con y sin ${simulada.concepto}`}
              hoy={r.hoy}
              reserva={r.reserva}
              series={[
                { nombre: 'Con la operación', valores: r.conOperacion, clase: 'serie-1' },
                { nombre: 'Sin la operación', valores: r.sinOperacion, clase: 'serie-2', punteada: true },
              ]}
            />

            <section className="bloque">
              <h2>Otras cuotas</h2>
              <div className="comparacion">
                {r.comparacion.map((c) => (
                  <button key={c.cuotas} className={`opcion-cuota${c.cuotas === simulada.entrada.cuotas ? ' opcion-cuota--elegida' : ''}`} aria-pressed={c.cuotas === simulada.entrada.cuotas} disabled={enviando} onClick={() => correr(c.cuotas)}>
                    <strong>{c.cuotas} cuotas</strong>
                    <span>{fmt(c.cuota)}</span>
                    {c.proporcion !== null && <small>{Math.round(c.proporcion * 100)}% de lo que te queda</small>}
                    <EstadoNivel nivel={c.nivel} />
                  </button>
                ))}
              </div>
            </section>

            <details className="grafico__tabla">
              <summary>Ver el cuadro de cuotas</summary>
              <div className="tabla-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Cuota</th>
                      <th scope="col">Interés</th>
                      <th scope="col">Capital</th>
                      <th scope="col">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.amortizacion.map((f) => (
                      <tr key={f.n}>
                        <td>{f.n}</td>
                        <td>{fmt(f.interes)}</td>
                        <td>{fmt(f.capital)}</td>
                        <td>{fmt(f.saldo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            {guardadas !== null ? (
              <div className="confirmacion" role="status">
                <p>
                  Guardamos {guardadas} {guardadas === 1 ? 'pago' : 'pagos'} en Pagos y cobros futuros.
                </p>
                <button className="boton boton--secundario" onClick={() => navegar('/vencimientos')}>
                  Ver Pagos y cobros futuros
                </button>
              </div>
            ) : confirmarRojo ? (
              <div className="confirmacion confirmacion--rojo" role="alert">
                <p>Esta operación te puede dejar sin plata. ¿Querés guardarla igual?</p>
                <div className="registro__acciones">
                  <button className="boton boton--peligro" disabled={enviando} onClick={() => guardar(true)}>
                    Guardar igual
                  </button>
                  <button className="boton boton--secundario" onClick={() => setConfirmarRojo(false)}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button className="boton boton--principal boton--inicio" disabled={enviando} onClick={() => guardar(false)}>
                Guardar en Pagos y cobros futuros
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
