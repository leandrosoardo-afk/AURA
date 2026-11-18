-- Borrar no hace desaparecer el registro:
-- * un pago o cobro agendado que se elimina queda "anulado" en el historial y se puede volver a agendar;
-- * si se borra el movimiento que salió de pagar algo agendado, ese pago vuelve a figurar como pendiente;
-- * todo movimiento borrado queda guardado en movimientos_eliminados y se puede restaurar.

ALTER TABLE compromisos DROP CONSTRAINT compromisos_estado_check;
ALTER TABLE compromisos ADD CONSTRAINT compromisos_estado_check CHECK (estado IN ('pendiente', 'pagado', 'anulado'));
ALTER TABLE compromisos
  ADD COLUMN anulado_en timestamptz,
  -- El pago mensual que se agendó solo al pagar este. Si el pago se deshace, ese próximo se saca.
  ADD COLUMN generado_por uuid REFERENCES compromisos (id) ON DELETE SET NULL;
GRANT UPDATE (anulado_en) ON compromisos TO cajaclara_v4_app;

CREATE TABLE movimientos_eliminados (
  id              uuid PRIMARY KEY,
  espacio_id      uuid NOT NULL,
  tipo            text NOT NULL,
  monto_ars       bigint NOT NULL,
  concepto        text NOT NULL,
  categoria       text NOT NULL,
  fecha           date NOT NULL,
  compromiso_id   uuid,
  importacion_id  uuid,
  eliminado_en    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX movimientos_eliminados_espacio ON movimientos_eliminados (espacio_id, eliminado_en DESC);

ALTER TABLE movimientos_eliminados ENABLE ROW LEVEL SECURITY;
CREATE POLICY eliminado_de_espacio_propio ON movimientos_eliminados
  USING (espacio_id IN (SELECT id FROM espacios_trabajo WHERE usuario_id = app_usuario_actual()))
  WITH CHECK (espacio_id IN (SELECT id FROM espacios_trabajo WHERE usuario_id = app_usuario_actual()));
GRANT SELECT, INSERT, DELETE ON movimientos_eliminados TO cajaclara_v4_app;
GRANT UPDATE (eliminado_en) ON movimientos_eliminados TO cajaclara_v4_app;

-- Antes de borrar un movimiento se guarda una copia. Si se está borrando el espacio entero
-- (por ejemplo, al eliminar la cuenta), no se guarda nada.
CREATE FUNCTION guardar_movimiento_eliminado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM espacios_trabajo WHERE id = OLD.espacio_id) THEN
    INSERT INTO movimientos_eliminados (id, espacio_id, tipo, monto_ars, concepto, categoria, fecha, compromiso_id, importacion_id)
    VALUES (OLD.id, OLD.espacio_id, OLD.tipo, OLD.monto_ars, OLD.concepto, OLD.categoria, OLD.fecha, OLD.compromiso_id, OLD.importacion_id)
    ON CONFLICT (id) DO UPDATE SET eliminado_en = now();
  END IF;
  RETURN OLD;
END
$$;

CREATE TRIGGER movimientos_guardar_eliminado
  BEFORE DELETE ON movimientos
  FOR EACH ROW EXECUTE FUNCTION guardar_movimiento_eliminado();
