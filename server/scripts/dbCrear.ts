// Prepara todo en un PostgreSQL local: .env con clave aleatoria, rol de la app,
// base principal, base de pruebas y migraciones. Se puede correr más de una vez.

import { randomBytes } from 'crypto';
import { existsSync, writeFileSync } from 'fs';
import { userInfo } from 'os';
import { resolve } from 'path';
import dotenv from 'dotenv';
import pg from 'pg';
import { migrar } from './migrar';

const ENV = resolve(import.meta.dirname, '../../.env');
const ROL = 'cajaclara_v4_app';
const BASES = ['cajaclara_v4', 'cajaclara_v4_test'];

if (!existsSync(ENV)) {
  const clave = randomBytes(24).toString('hex');
  const admin = process.env.DATABASE_ADMIN_URL ?? `postgres://${userInfo().username}@localhost:5432/postgres`;
  writeFileSync(
    ENV,
    [
      `DATABASE_ADMIN_URL=${admin}`,
      `DATABASE_URL=postgres://${ROL}:${clave}@localhost:5432/${BASES[0]}`,
      `DATABASE_TEST_URL=postgres://${ROL}:${clave}@localhost:5432/${BASES[1]}`,
      '# Clave de Gemini para el chatbot. Sin clave responde la guía local.',
      'GEMINI_API_KEY=',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  console.log('Creado .env con una clave aleatoria.');
}
dotenv.config({ path: ENV, quiet: true });

const adminUrl = process.env.DATABASE_ADMIN_URL!;
const clave = decodeURIComponent(new URL(process.env.DATABASE_URL!).password);

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
const existeRol = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROL]);
await admin.query(
  `${existeRol.rowCount ? 'ALTER' : 'CREATE'} ROLE ${admin.escapeIdentifier(ROL)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${admin.escapeLiteral(clave)}`,
);
for (const base of BASES) {
  const existe = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [base]);
  if (!existe.rowCount) {
    await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(base)} ENCODING 'UTF8'`);
    console.log(`Creada la base ${base}.`);
  }
}
await admin.end();

for (const base of BASES) await migrar(adminUrl, base);
console.log('Base de datos lista.');
