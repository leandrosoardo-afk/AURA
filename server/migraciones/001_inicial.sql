-- Caja Clara V4 · Esquema inicial
-- La app se conecta con el rol cajaclara_v4_app, que no es dueño de las tablas
-- ni tiene BYPASSRLS. Por eso las políticas de RLS se aplican a todas sus consultas.

CREATE TABLE usuarios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL CHECK (email = lower(email)),
  tipo        text NOT NULL CHECK (tipo IN ('pyme', 'persona')),
  clave_hash  text NOT NULL,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX usuarios_email_unico ON usuarios (email);

-- Solo se guarda el hash del token: una fuga de esta tabla no permite abrir sesiones.
CREATE TABLE sesiones (
  token_hash  text PRIMARY KEY,
  usuario_id  uuid NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  expira_en   timestamptz NOT NULL,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sesiones_usuario ON sesiones (usuario_id);

CREATE TABLE perfiles (
  usuario_id      uuid PRIMARY KEY REFERENCES usuarios (id) ON DELETE CASCADE,
  nombre          text NOT NULL,
  nombre_negocio  text,
  respuestas      jsonb NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now()
);

-- Los precios y lo que incluye cada plan viven acá para cambiarlos sin tocar código.
CREATE TABLE planes (
  codigo                  text PRIMARY KEY,
  nombre                  text NOT NULL,
  orden                   int  NOT NULL,
  precio_mensual_ars      int  NOT NULL CHECK (precio_mensual_ars >= 0),
  incluye_publicidad      boolean NOT NULL,
  limite_registros_mes    int,
  modulos                 text[] NOT NULL,
  beneficios              text[] NOT NULL
);

INSERT INTO planes VALUES
  ('gratis', 'Gratis', 1, 0, true, 30,
   ARRAY['movimientos', 'caja'],
   ARRAY['Incluye publicidad', '30 registros por mes', 'Movimientos y caja a 30 días']),
  ('intermedio', 'Intermedio', 2, 9900, false, NULL,
   ARRAY['movimientos', 'caja', 'vencimientos', 'alertas', 'simulador', 'metas'],
   ARRAY['Sin publicidad', 'Registros sin límite', 'Vencimientos, alertas, simulador y metas']),
  ('full', 'Full', 3, 25900, false, NULL,
   ARRAY['movimientos', 'caja', 'vencimientos', 'alertas', 'simulador', 'metas', 'asistente', 'informes', 'escenarios'],
   ARRAY['Sin publicidad', 'Todo lo del plan Intermedio', 'Asistente con IA, informes y escenarios']);

-- Todavía no hay cobros: el estado deja explícito que nadie pagó este plan.
CREATE TABLE suscripciones (
  usuario_id   uuid PRIMARY KEY REFERENCES usuarios (id) ON DELETE CASCADE,
  plan_codigo  text NOT NULL REFERENCES planes (codigo),
  estado       text NOT NULL DEFAULT 'sin_cobro' CHECK (estado IN ('sin_cobro')),
  creado_en    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE espacios_trabajo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  uuid NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  nombre      text NOT NULL,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX espacios_usuario ON espacios_trabajo (usuario_id);

CREATE TABLE movimientos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  espacio_id uuid NOT NULL REFERENCES espacios_trabajo (id) ON DELETE CASCADE,
  tipo       text NOT NULL CHECK (tipo IN ('ingreso', 'egreso')),
  monto_ars  bigint NOT NULL CHECK (monto_ars > 0),
  concepto   text NOT NULL,
  categoria  text NOT NULL,
  fecha      date NOT NULL,
  creado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX movimientos_espacio_fecha ON movimientos (espacio_id, fecha DESC);

-- Un usuario no puede existir sin perfil, espacio de trabajo y plan.
-- Se verifica al confirmar la transacción, sea cual sea el código que lo haya creado.
CREATE FUNCTION verificar_alta_completa() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM perfiles WHERE usuario_id = NEW.id)
     OR NOT EXISTS (SELECT 1 FROM espacios_trabajo WHERE usuario_id = NEW.id)
     OR NOT EXISTS (SELECT 1 FROM suscripciones WHERE usuario_id = NEW.id) THEN
    RAISE EXCEPTION 'alta incompleta: el usuario % necesita perfil, espacio y plan', NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER usuarios_alta_completa
  AFTER INSERT ON usuarios
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION verificar_alta_completa();

-- Aislamiento: cada transacción declara su usuario con set_config('app.usuario_id', ...).
-- Si no lo declara, la función devuelve NULL y las políticas no dejan ver ninguna fila.
CREATE FUNCTION app_usuario_actual() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.usuario_id', true), '')::uuid
$$;

ALTER TABLE perfiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE suscripciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE espacios_trabajo ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos ENABLE ROW LEVEL SECURITY;

CREATE POLICY perfil_propio ON perfiles
  USING (usuario_id = app_usuario_actual())
  WITH CHECK (usuario_id = app_usuario_actual());

CREATE POLICY suscripcion_propia ON suscripciones
  USING (usuario_id = app_usuario_actual())
  WITH CHECK (usuario_id = app_usuario_actual());

CREATE POLICY espacio_propio ON espacios_trabajo
  USING (usuario_id = app_usuario_actual())
  WITH CHECK (usuario_id = app_usuario_actual());

CREATE POLICY movimiento_de_espacio_propio ON movimientos
  USING (espacio_id IN (SELECT id FROM espacios_trabajo WHERE usuario_id = app_usuario_actual()))
  WITH CHECK (espacio_id IN (SELECT id FROM espacios_trabajo WHERE usuario_id = app_usuario_actual()));

-- Permisos mínimos: sin DROP, sin TRUNCATE y sin cambiar precios ni dueños.
GRANT SELECT, INSERT ON usuarios, perfiles, suscripciones, espacios_trabajo TO cajaclara_v4_app;
GRANT SELECT, INSERT, DELETE ON sesiones, movimientos TO cajaclara_v4_app;
GRANT SELECT ON planes TO cajaclara_v4_app;
