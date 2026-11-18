import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { api, type Yo } from './api';

interface Seccion<T> {
  datos: T | null;
  fuente: string;
  obtenidoEn: string | null;
  desactualizado: boolean;
}

interface LineaCredito {
  entidad: string;
  producto: string;
  moneda: string;
  tasa: string | null;
  beneficiario: string;
  tea: number | null;
  cft: number;
  plazoMeses: number | null;
  montoMaximo: number | null;
  ingresoMinimo: number | null;
  fecha: string;
  nota: string | null;
}

interface RespuestaMercado {
  dolar: Seccion<{ casa: string; nombre: string; compra: number | null; venta: number | null; fecha: string }[]>;
  referencias: Seccion<{ id: number; nombre: string; tna: number; fecha: string }[]>;
  creditos: Record<'personales' | 'prendarios' | 'hipotecarios', Seccion<{ banco: string; linea: LineaCredito | null }[]>>;
  plazoFijo: Seccion<{ entidad: string; tnaClientes: number; tnaNoClientes: number | null }[]>;
  letras: Seccion<{ ticker: string; tna: number; tea: number | null; vencimiento: string }[]>;
  fondos: Seccion<{ fondo: string; categoria: string; fecha: string; rendimiento: number | null; dias: number | null; patrimonio: number | null }[]>;
}

type Pestana = 'dolar' | 'creditos' | 'inversiones';
type TipoCredito = keyof RespuestaMercado['creditos'];

const pesos = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(n);
const pesosEnteros = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
const porcentaje = (n: number) => `${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })}%`;
const fechaCompleta = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires' });
const fechaDia = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

function Fuente({ seccion }: { seccion: Seccion<unknown> }) {
  return (
    <p className="contador">
      Fuente: {seccion.fuente}.{seccion.obtenidoEn && ` Consultado el ${fechaCompleta(seccion.obtenidoEn)}.`}
      {seccion.desactualizado && (
        <span className="mercado__aviso">
          <TriangleAlert size={14} aria-hidden="true" /> No pudimos actualizar: estos son los últimos datos obtenidos.
        </span>
      )}
    </p>
  );
}

function SinDatos({ fuente }: { fuente: string }) {
  return <p className="nota">Ahora no pudimos obtener estos datos de {fuente}. Probá de nuevo en unos minutos.</p>;
}


export function Mercado({ yo }: { yo: Yo }) {
  const [datos, setDatos] = useState<RespuestaMercado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>('dolar');
  const [tipoCredito, setTipoCredito] = useState<TipoCredito>('personales');
  const esPyme = yo.usuario.tipo === 'pyme';

  useEffect(() => {
    api<RespuestaMercado>('/mercado')
      .then(setDatos)
      .catch((err) => setError(err.message));
  }, []);

  const seccionCredito = datos?.creditos[tipoCredito];

  return (
    <div className="pantalla pantalla--ancha">
      <h1 className="titulo-pantalla">Mercado</h1>
      <p className="nota">Datos públicos para comparar. No son recomendaciones ni ofertas de AURA.</p>

      <div className="segmentado segmentado--tres" role="group" aria-label="Sección de mercado">
        {(
          [
            ['dolar', 'Dólar'],
            ['creditos', 'Créditos'],
            ['inversiones', 'Inversiones'],
          ] as [Pestana, string][]
        ).map(([id, nombre]) => (
          <button key={id} type="button" aria-pressed={pestana === id} onClick={() => setPestana(id)}>
            {nombre}
          </button>
        ))}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!datos && !error && <div className="esqueleto" aria-busy="true" />}

      {datos && pestana === 'dolar' && (
        <section className="bloque">
          <h2>Cotización del dólar</h2>
          {datos.dolar.datos ? (
            <>
              <ul className="cotizaciones">
                {datos.dolar.datos.map((d) => (
                  <li key={d.casa}>
                    <strong>{d.nombre}</strong>
                    <dl>
                      <div>
                        <dt>Compra</dt>
                        <dd>{d.compra !== null ? pesos(d.compra) : 'Sin dato'}</dd>
                      </div>
                      <div>
                        <dt>Venta</dt>
                        <dd>{d.venta !== null ? pesos(d.venta) : 'Sin dato'}</dd>
                      </div>
                    </dl>
                    <small>Actualizado el {fechaCompleta(d.fecha)}</small>
                  </li>
                ))}
              </ul>
              <Fuente seccion={datos.dolar} />
            </>
          ) : (
            <SinDatos fuente={datos.dolar.fuente} />
          )}
        </section>
      )}

      {datos && pestana === 'creditos' && (
        <>
          <section className="bloque">
            <h2>Tasas de referencia del sistema</h2>
            {datos.referencias.datos ? (
              <>
                <ul className="referencias">
                  {datos.referencias.datos.map((r) => (
                    <li key={r.id}>
                      <span>{r.nombre}</span>
                      <strong>{porcentaje(r.tna)} TNA</strong>
                      <small>al {fechaDia(r.fecha)}</small>
                    </li>
                  ))}
                </ul>
                <Fuente seccion={datos.referencias} />
              </>
            ) : (
              <SinDatos fuente={datos.referencias.fuente} />
            )}
          </section>

          <section className="bloque">
            <h2>Préstamos de los 5 bancos principales</h2>
            <div className="segmentado segmentado--tres" role="group" aria-label="Tipo de préstamo">
              {(
                [
                  ['personales', 'Personales'],
                  ['prendarios', 'Prendarios'],
                  ['hipotecarios', 'Hipotecarios'],
                ] as [TipoCredito, string][]
              ).map(([id, nombre]) => (
                <button key={id} type="button" aria-pressed={tipoCredito === id} onClick={() => setTipoCredito(id)}>
                  {nombre}
                </button>
              ))}
            </div>
            {esPyme && <p className="contador">El BCRA no publica líneas específicas para PyMEs: para capital de trabajo o inversión, consultá directamente con cada entidad.</p>}
            {seccionCredito?.datos ? (
              <>
                <p className="contador">Nación, Galicia, Santander, BBVA y Provincia: los que más depósitos tienen. Una línea por banco, la de menor costo para todo público.</p>
                <ul className="creditos">
                  {seccionCredito.datos.map(({ banco, linea: l }) =>
                    l ? (
                      <li key={banco}>
                        <div className="creditos__principal">
                          <strong>{banco}</strong>
                          <small>{l.producto}</small>
                          <small>Para: {l.beneficiario}</small>
                        </div>
                        <div className="creditos__costo">
                          <strong>{porcentaje(l.cft)}</strong>
                          <small>{l.moneda === 'UVA' ? 'CFT máximo + inflación' : 'CFT máximo'}</small>
                        </div>
                        <dl className="creditos__datos">
                          {l.tea !== null && (
                            <div>
                              <dt>TEA máx.</dt>
                              <dd>{porcentaje(l.tea)}</dd>
                            </div>
                          )}
                          <div>
                            <dt>Moneda</dt>
                            <dd>{l.moneda}</dd>
                          </div>
                          {l.plazoMeses !== null && (
                            <div>
                              <dt>Plazo máx.</dt>
                              <dd>{l.plazoMeses} meses</dd>
                            </div>
                          )}
                          {l.montoMaximo !== null && (
                            <div>
                              <dt>Monto máx.</dt>
                              <dd>{pesosEnteros(l.montoMaximo)}</dd>
                            </div>
                          )}
                        </dl>
                        <small className="creditos__fecha">Informado el {fechaDia(l.fecha)}</small>
                      </li>
                    ) : (
                      <li key={banco} className="creditos__vacio">
                        <strong>{banco}</strong>
                        <small>No informó al BCRA una línea vigente de este tipo.</small>
                      </li>
                    ),
                  )}
                </ul>
                {seccionCredito.datos.some((b) => b.linea?.moneda === 'UVA') && <p className="contador">Las líneas UVA se ajustan por inflación además de su costo.</p>}
              </>
            ) : (
              <SinDatos fuente={seccionCredito?.fuente ?? 'BCRA'} />
            )}
            {seccionCredito && <Fuente seccion={seccionCredito} />}
            <p className="contador">El costo real depende de tu perfil. Confirmá las condiciones con la entidad antes de decidir.</p>
          </section>
        </>
      )}

      {datos && pestana === 'inversiones' && (
        <>
          <section className="bloque">
            <h2>Plazo fijo en los 5 bancos principales</h2>
            {datos.plazoFijo.datos ? (
              <>
                <div className="tabla-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col" className="tabla__texto">Banco</th>
                        <th scope="col">TNA clientes</th>
                        <th scope="col">TNA no clientes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.plazoFijo.datos.map((f) => (
                        <tr key={f.entidad}>
                          <td className="tabla__texto">{f.entidad}</td>
                          <td>{porcentaje(f.tnaClientes)}</td>
                          <td>{f.tnaNoClientes !== null ? porcentaje(f.tnaNoClientes) : 'Sin dato'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Fuente seccion={datos.plazoFijo} />
              </>
            ) : (
              <SinDatos fuente={datos.plazoFijo.fuente} />
            )}
          </section>

          <section className="bloque">
            <h2>Letras del Tesoro</h2>
            {datos.letras.datos ? (
              <>
                <div className="tabla-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Letra</th>
                        <th scope="col">Vencimiento</th>
                        <th scope="col">TNA</th>
                        <th scope="col">TEA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.letras.datos.map((l) => (
                        <tr key={l.ticker}>
                          <td>{l.ticker}</td>
                          <td>{fechaDia(l.vencimiento)}</td>
                          <td>{porcentaje(l.tna)}</td>
                          <td>{l.tea !== null ? porcentaje(l.tea) : 'Sin dato'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Fuente seccion={datos.letras} />
              </>
            ) : (
              <SinDatos fuente={datos.letras.fuente} />
            )}
          </section>

          <section className="bloque">
            <h2>Fondos comunes de inversión</h2>
            {datos.fondos.datos ? (
              <>
                <p className="contador">Los fondos en pesos más grandes de cada categoría. Lo que rindió antes no garantiza lo que va a rendir.</p>
                <div className="tabla-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col" className="tabla__texto">Fondo</th>
                        <th scope="col" className="tabla__texto">Categoría</th>
                        <th scope="col">Rendimiento reciente</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.fondos.datos.map((f) => (
                        <tr key={`${f.categoria}-${f.fondo}`}>
                          <td className="tabla__texto">{f.fondo}</td>
                          <td className="tabla__texto">{f.categoria}</td>
                          <td>{f.rendimiento !== null && f.dias ? `${porcentaje(f.rendimiento)} en ${f.dias} días` : 'Sin dato'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Fuente seccion={datos.fondos} />
              </>
            ) : (
              <SinDatos fuente={datos.fondos.fuente} />
            )}
          </section>
          <p className="contador">Antes de invertir, leé las condiciones de cada producto. AURA no da asesoramiento de inversión.</p>
        </>
      )}
    </div>
  );
}
