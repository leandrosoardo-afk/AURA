-- Lo que entra y lo que sale se calculan con los movimientos: de la caja solo se guarda la reserva.
ALTER TABLE parametros_caja DROP COLUMN margen_mensual, DROP COLUMN venta_diaria, DROP COLUMN gasto_diario;

-- Un movimiento que nació al marcar pagado un vencimiento ya está agendado aparte:
-- se marca para no sumarlo también al promedio diario de la caja.
ALTER TABLE movimientos ADD COLUMN compromiso_id uuid REFERENCES compromisos (id) ON DELETE SET NULL;

-- Recuperación de contraseña. Como en las sesiones, solo se guarda el hash del token.
CREATE TABLE recuperaciones (
  token_hash  text PRIMARY KEY,
  usuario_id  uuid NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  expira_en   timestamptz NOT NULL,
  usado_en    timestamptz,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recuperaciones_usuario ON recuperaciones (usuario_id);

GRANT SELECT, INSERT, DELETE ON recuperaciones TO cajaclara_v4_app;
GRANT UPDATE (usado_en) ON recuperaciones TO cajaclara_v4_app;
GRANT UPDATE (clave_hash) ON usuarios TO cajaclara_v4_app;
