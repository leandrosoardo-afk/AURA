import { resolve } from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(import.meta.dirname, '../.env'), quiet: true });

const esTest = Boolean(process.env.VITEST);

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta ${nombre} en .env. Corré "npm run db:crear" para generarlo.`);
  return valor;
}

/** En Docker la base sigue en esta Mac: se cambia solo el host de la dirección. */
function conHost(url: string): string {
  const host = process.env.DATABASE_HOST;
  if (!host) return url;
  const u = new URL(url);
  u.hostname = host;
  return u.toString();
}

export const config = {
  databaseUrl: conHost(requerida(esTest ? 'DATABASE_TEST_URL' : 'DATABASE_URL')),
  host: process.env.HOST ?? '127.0.0.1',
  // Proxies en los que se confía para leer la IP real (Vite en desarrollo, el túnel en Docker).
  proxiesConfiables: process.env.TRUST_PROXY ?? 'loopback',
  // En Docker la misma API entrega la web ya compilada (carpeta dist).
  servirWeb: process.env.SERVIR_WEB === '1',
  port: Number(process.env.API_PORT ?? 3101),
  produccion: process.env.NODE_ENV === 'production',
  // Dirección pública de la app, para los enlaces que se mandan por mail.
  urlApp: (process.env.APP_URL ?? 'http://localhost:4173').replace(/\/$/, ''),
  origenes: (process.env.APP_ORIGINS ?? 'http://localhost:4173,http://127.0.0.1:4173').split(','),
};
