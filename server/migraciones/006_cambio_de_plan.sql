-- El usuario puede cambiar de plan (subir o bajar) desde Configuración. Por ahora no se cobra nada.
ALTER TABLE suscripciones ADD COLUMN cambiado_en timestamptz;
GRANT UPDATE (plan_codigo, cambiado_en) ON suscripciones TO cajaclara_v4_app;
