import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { FileUp, X } from 'lucide-react';
import { fechaCorta } from '../shared/motor';
import { api, fechaDeHoy, type Resumen, type Yo } from './api';
import { CampoPesos, digitos } from './comunes';

/** El mismo formulario sirve en Movimientos y en la hoja que abre el botón +. */
export function FormularioMovimiento({
  yo,
  espacioId,
  resumen,
  alRegistrar,
  alImportar,
  enfocar = false,
}: {
  yo: Yo;
  espacioId: string;
  resumen: Resumen | null;
  alRegistrar: (registro: { id: string; tipo: 'ingreso' | 'egreso'; fecha: string }) => Promise<void> | void;
  /** Muestra el botón para cargar muchos gastos de una vez desde una planilla. */
  alImportar?: () => void;
  enfocar?: boolean;
}) {
  const [tipo, setTipo] = useState<'ingreso' | 'egreso'>('egreso');
  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');
  const [categoria, setCategoria] = useState<string | null>(null);
  const [fecha, setFecha] = useState(fechaDeHoy);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const primerCampo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (enfocar) primerCampo.current?.querySelector('input')?.focus();
  }, [enfocar]);

  const categorias = yo.adaptacion.categorias[tipo];
  const sinCupo = resumen !== null && resumen.limiteRegistrosMes !== null && resumen.registrosMes >= resumen.limiteRegistrosMes;

  async function registrar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!categoria) {
      setError('Elegí una categoría.');
      return;
    }
    setEnviando(true);
    try {
      const { id } = await api<{ id: string }>(`/espacios/${espacioId}/movimientos`, {
        metodo: 'POST',
        cuerpo: { tipo, monto: digitos(monto), concepto, categoria, fecha },
      });
      setMonto('');
      setConcepto('');
      setCategoria(null);
      await alRegistrar({ id, tipo, fecha });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="registro" onSubmit={registrar}>
      {alImportar && (
        <button type="button" className="boton boton--secundario registro__importar" onClick={alImportar}>
          <FileUp size={18} aria-hidden="true" /> Importar gastos desde Excel
        </button>
      )}
      <div className="segmentado" role="group" aria-label="Tipo de movimiento">
        {(['egreso', 'ingreso'] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tipo === t}
            onClick={() => {
              setTipo(t);
              setCategoria(null);
            }}
          >
            {t === 'egreso' ? 'Gasto' : 'Ingreso'}
          </button>
        ))}
      </div>
      <div ref={primerCampo}>
        <CampoPesos etiqueta="Monto" valor={monto} alCambiar={setMonto} />
      </div>
      <label className="campo">
        Concepto
        <input required maxLength={120} placeholder={tipo === 'ingreso' ? '¿De dónde vino?' : '¿En qué se fue?'} value={concepto} onChange={(e) => setConcepto(e.target.value)} />
      </label>
      <fieldset className="categorias">
        <legend>Categoría</legend>
        {categorias.map((c) => (
          <button key={c} type="button" className={`chip${categoria === c ? ' chip--elegido' : ''}`} aria-pressed={categoria === c} onClick={() => setCategoria(c)}>
            {c}
          </button>
        ))}
      </fieldset>
      <label className="campo">
        Fecha
        <input type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} />
        {fecha > fechaDeHoy() && <small>Queda programado: se descuenta solo el {fechaCorta(fecha)} y mientras tanto aparece en tus pagos agendados.</small>}
      </label>
      {resumen && resumen.limiteRegistrosMes !== null && (
        <p className="contador">
          Cargaste {resumen.registrosMes} de {resumen.limiteRegistrosMes} registros este mes.
        </p>
      )}
      {sinCupo && <p className="error">Llegaste al límite de registros de este mes en tu plan.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="boton boton--principal" disabled={enviando || sinCupo}>
        {enviando ? 'Registrando…' : tipo === 'ingreso' ? 'Registrar ingreso' : 'Registrar gasto'}
      </button>
    </form>
  );
}

/** Hoja inferior en el celular y ventana centrada en la computadora. */
export function Hoja({ titulo, abierta, alCerrar, children }: { titulo: string; abierta: boolean; alCerrar: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierta) return;
    const previo = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') alCerrar();
    };
    document.addEventListener('keydown', alTeclear);
    return () => {
      document.removeEventListener('keydown', alTeclear);
      previo?.focus();
    };
  }, [abierta, alCerrar]);

  if (!abierta) return null;
  return (
    <div className="hoja__fondo" onClick={alCerrar}>
      <div className="hoja" role="dialog" aria-modal="true" aria-label={titulo} tabIndex={-1} ref={panel} onClick={(e) => e.stopPropagation()}>
        <span className="hoja__agarre" aria-hidden="true" />
        <header className="hoja__cabecera">
          <h2>{titulo}</h2>
          <button className="boton-icono" aria-label="Cerrar" onClick={alCerrar}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
