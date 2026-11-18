-- Datos que alimentan la caja proyectada y agenda de pagos y cobros de cada espacio.

CREATE TABLE parametros_caja (
  espacio_id     uuid PRIMARY KEY REFERENCES espacios_trabajo (id) ON DELETE CASCADE,
  reserva        numeric(15, 2) NOT NULL CHECK (reserva >= 0),
  margen_mensual numeric(15, 2) NOT NULL CHECK (margen_mensual >= 0),
  venta_diaria   numeric(15, 2) NOT NULL CHECK (venta_diaria >= 0),
  gasto_diario   numeric(15, 2) NOT NULL CHECK (gasto_diario >= 0),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE compromisos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  espacio_id    uuid NOT NULL REFERENCES espacios_trabajo (id) ON DELETE CASCADE,
  tipo          text NOT NULL CHECK (tipo IN ('pago', 'cobro')),
  monto_ars     bigint NOT NULL CHECK (monto_ars > 0),
  concepto      text NOT NULL,
  categoria     text NOT NULL,
  fecha         date NOT NULL,
  estado        text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagado')),
  mensual       boolean NOT NULL DEFAULT false,
  aviso_dias    int NOT NULL DEFAULT 2 CHECK (aviso_dias BETWEEN 0 AND 30),
  pagado_en     timestamptz,
  creado_en     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX compromisos_espacio_estado_fecha ON compromisos (espacio_id, estado, fecha);

ALTER TABLE parametros_caja ENABLE ROW LEVEL SECURITY;
ALTER TABLE compromisos ENABLE ROW LEVEL SECURITY;

CREATE POLICY parametros_de_espacio_propio ON parametros_caja
  USING (espacio_id IN (SELECT id FROM espacios_trabajo WHERE usuario_id = app_usuario_actual()))
  WITH CHECK (espacio_id IN (SELECT id FROM espacios_trabajo WHERE usuario_id = app_usuario_actual()));

CREATE POLICY compromiso_de_espacio_propio ON compromisos
  USING (espacio_id IN (SELECT id FROM espacios_trabajo WHERE usuario_id = app_usuario_actual()))
  WITH CHECK (espacio_id IN (SELECT id FROM espacios_trabajo WHERE usuario_id = app_usuario_actual()));

-- Update por columna: un registro nunca se puede mover a otro espacio.
GRANT SELECT, INSERT ON parametros_caja TO cajaclara_v4_app;
GRANT UPDATE (reserva, margen_mensual, venta_diaria, gasto_diario, actualizado_en) ON parametros_caja TO cajaclara_v4_app;
GRANT SELECT, INSERT, DELETE ON compromisos TO cajaclara_v4_app;
GRANT UPDATE (fecha, estado, pagado_en) ON compromisos TO cajaclara_v4_app;
