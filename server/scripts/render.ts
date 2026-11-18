// Arranque en Render: prepara la base y después levanta la app.
//
// Render entrega DATABASE_ADMIN_URL (el dueño de la base) y APP_DB_CLAVE (una clave
// aleatoria que genera Render). Con eso se crea el rol limitado de la app, se aplican
// las migraciones y la app se conecta con ese rol, sujeta a RLS, igual que en la Mac.

import pg from 'pg';
import { migrar } from './migrar';

const ROL = 'cajaclara_v4_app';
const adminUrl = process.env.DATABASE_ADMIN_URL;
const clave = process.env.APP_DB_CLAVE;
if (!adminUrl || !clave) {
  console.error('Faltan DATABASE_ADMIN_URL o APP_DB_CLAVE en las variables de Render.');
  process.exit(1);
}

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
try {
  const existe = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROL]);
  await admin.query(
    `${existe.rowCount ? 'ALTER' : 'CREATE'} ROLE ${admin.escapeIdentifier(ROL)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${admin.escapeLiteral(clave)}`,
  );
  const base = new URL(adminUrl).pathname.slice(1);
  await admin.query(`GRANT CONNECT ON DATABASE ${admin.escapeIdentifier(base)} TO ${admin.escapeIdentifier(ROL)}`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${admin.escapeIdentifier(ROL)}`);
} finally {
  await admin.end();
}

const app = new URL(adminUrl);
await migrar(adminUrl, app.pathname.slice(1));

app.username = ROL;
app.password = clave;
process.env.DATABASE_URL = app.toString();
console.log('Base lista; la app se conecta con el rol limitado.');

await import('../index');
