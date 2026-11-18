import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const CARPETA = resolve(import.meta.dirname, '../migraciones');

/** Cambia la base de una URL de conexión, conservando usuario, host y parámetros. */
export function urlDeBase(url: string, base: string): string {
  return url.replace(/\/[^/?]*(\?.*)?$/, `/${base}$1`);
}

/** Aplica en orden las migraciones pendientes, cada una en su transacción. */
export async function migrar(adminUrl: string, base: string): Promise<void> {
  const cliente = new pg.Client({ connectionString: urlDeBase(adminUrl, base) });
  await cliente.connect();
  try {
    await cliente.query('CREATE TABLE IF NOT EXISTS _migraciones (nombre text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())');
    const aplicadas = new Set((await cliente.query('SELECT nombre FROM _migraciones')).rows.map((f) => f.nombre));
    for (const archivo of readdirSync(CARPETA).filter((f) => f.endsWith('.sql')).sort()) {
      if (aplicadas.has(archivo)) continue;
      await cliente.query('BEGIN');
      try {
        await cliente.query(readFileSync(resolve(CARPETA, archivo), 'utf8'));
        await cliente.query('INSERT INTO _migraciones (nombre) VALUES ($1)', [archivo]);
        await cliente.query('COMMIT');
        console.log(`${base}: aplicada ${archivo}`);
      } catch (error) {
        await cliente.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await cliente.end();
  }
}
