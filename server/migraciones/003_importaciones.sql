-- Identifica los movimientos que entraron juntos desde una planilla, para poder deshacer esa carga.
ALTER TABLE movimientos ADD COLUMN importacion_id uuid;
CREATE INDEX movimientos_importacion ON movimientos (importacion_id) WHERE importacion_id IS NOT NULL;
