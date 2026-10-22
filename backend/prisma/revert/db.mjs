/**
 * Runs mysql / mysqldump with the connection in backend/.env, so no password
 * is typed or shown. Run from the backend folder:
 *
 *   node prisma/revert/db.mjs dump ~/backup-before-revert.sql
 *   node prisma/revert/db.mjs sql  prisma/revert/01-precheck.sql
 */
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const [mode, file] = process.argv.slice(2);
if (!['sql', 'dump'].includes(mode) || !file) {
  console.error('usage: node prisma/revert/db.mjs sql <file.sql> | dump <out.sql>');
  process.exit(2);
}

const line = readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
if (!line) {
  console.error('DATABASE_URL not found in .env — run this from the backend folder');
  process.exit(2);
}
const url = new URL(line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, ''));
const database = url.pathname.slice(1);
const args = ['-h', url.hostname, '-P', url.port || '3306', '-u', decodeURIComponent(url.username)];
const env = { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) };
console.error(`database: ${database} on ${url.hostname}`);

const child =
  mode === 'sql'
    ? spawn('mysql', [...args, '-t', database], { env, stdio: ['pipe', 'inherit', 'inherit'] })
    : spawn('mysqldump', [...args, '--single-transaction', '--routines', '--triggers', database], { env, stdio: ['ignore', 'pipe', 'inherit'] });

if (mode === 'sql') createReadStream(file).pipe(child.stdin);
else child.stdout.pipe(createWriteStream(file));

child.on('close', (code) => {
  if (code === 0 && mode === 'dump') console.error(`backup written to ${file}`);
  process.exit(code ?? 1);
});
