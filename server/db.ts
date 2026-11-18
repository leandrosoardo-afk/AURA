import pg from 'pg';
import { config } from './config';

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

// Si la base corta una conexión inactiva (reinicio o mantenimiento del servidor), el pool
// avisa con este evento. Sin este manejador Node se cierra; así se registra y el pool
// abre una conexión nueva en el próximo pedido.
pool.on('error', (error) => {
  console.error(`Se perdió una conexión con la base: ${error.message}`);
});

/**
 * Ejecuta `fn` en una transacción a nombre de un usuario. Las políticas de RLS
 * solo dejan ver y escribir sus filas, y el valor se descarta al terminar,
 * así que no pasa a la próxima consulta que use esa conexión.
 */
export async function conUsuario<T>(usuarioId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query(`SELECT set_config('app.usuario_id', $1, true)`, [usuarioId]);
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}
