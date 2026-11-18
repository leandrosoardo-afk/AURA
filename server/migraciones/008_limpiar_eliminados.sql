-- Al borrar un espacio (o la cuenta entera) también se borran sus movimientos eliminados guardados.
-- El nombre empieza con "zz" para que corra después del borrado en cascada de sus movimientos.
CREATE FUNCTION limpiar_eliminados_del_espacio() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM movimientos_eliminados WHERE espacio_id = OLD.id;
  RETURN OLD;
END
$$;

CREATE TRIGGER zz_espacio_limpiar_eliminados
  AFTER DELETE ON espacios_trabajo
  FOR EACH ROW EXECUTE FUNCTION limpiar_eliminados_del_espacio();

DELETE FROM movimientos_eliminados e WHERE NOT EXISTS (SELECT 1 FROM espacios_trabajo w WHERE w.id = e.espacio_id);
