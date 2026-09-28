// Zero-install demo mode: runs a temporary MySQL server inside Node, so you
// don't need Docker or a MySQL installation. Only Node.js is required.
//
//   npm run demo
//
// The first run downloads a portable MySQL build (cached for next time).
// Data lives only while the demo runs; each start loads a fresh copy of the seed.
import { createDB } from 'mysql-memory-server';
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.join(__dirname, '..', 'sql');
const SQL_FILES = ['01_schema.sql', '02_seed_data.sql', '03_views.sql'];

console.log('Starting embedded MySQL (first run downloads it, this can take a minute)…');
const db = await createDB({ version: '8.4.x', logLevel: 'ERROR' });
console.log(`MySQL ${db.mysql.version} running on port ${db.port}`);

const conn = await mysql.createConnection({
  host: '127.0.0.1',
  port: db.port,
  user: db.username,
  multipleStatements: true,
});
for (const file of SQL_FILES) {
  process.stdout.write(`Loading ${file}… `);
  await conn.query(readFileSync(path.join(SQL_DIR, file), 'utf8'));
  console.log('done');
}
await conn.end();

// Point the dashboard at the embedded server (these take priority over app/.env).
Object.assign(process.env, {
  DB_HOST: '127.0.0.1',
  DB_PORT: String(db.port),
  DB_USER: db.username,
  DB_PASSWORD: '',
  DB_NAME: 'talent_acquisition',
});

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping MySQL…');
  await db.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await import('./server.js');
