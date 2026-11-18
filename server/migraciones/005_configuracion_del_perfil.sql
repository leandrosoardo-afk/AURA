-- Configuración: el usuario puede editar su nombre, apellido, el nombre del negocio y una foto.
ALTER TABLE perfiles
  ADD COLUMN apellido text,
  ADD COLUMN foto text,
  -- La foto llega achicada desde el navegador (256 px); el tope evita guardar archivos enormes.
  ADD CONSTRAINT perfiles_foto_valida CHECK (foto IS NULL OR (length(foto) <= 400000 AND foto ~ '^data:image/(jpeg|png|webp);base64,'));

GRANT UPDATE (nombre, apellido, nombre_negocio, foto) ON perfiles TO cajaclara_v4_app;
GRANT UPDATE (nombre) ON espacios_trabajo TO cajaclara_v4_app;
