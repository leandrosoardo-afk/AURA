import { resolve } from 'path';
import dotenv from 'dotenv';
import { migrar } from './migrar';

dotenv.config({ path: resolve(import.meta.dirname, '../../.env'), quiet: true });

const adminUrl = process.env.DATABASE_ADMIN_URL;
const url = process.argv.includes('--test') ? process.env.DATABASE_TEST_URL : process.env.DATABASE_URL;
if (!adminUrl || !url) {
  console.error('Falta la configuración de la base. Corré "npm run db:crear".');
  process.exit(1);
}
await migrar(adminUrl, new URL(url).pathname.slice(1));
