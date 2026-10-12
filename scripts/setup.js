import { randomBytes } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';

try {
  await access('.env');
  console.log('Tu .env ya existe. Conservé tus claves y configuración.');
} catch {
  await writeFile('.env', `PORT=3000\nDATA_DIR=./data\nTIME_ZONE=America/Lima\nADMIN_PASSWORD=${randomBytes(15).toString('base64url')}\nSESSION_SECRET=${randomBytes(36).toString('base64url')}\nOWNER_EMAIL=\nSMTP_HOST=smtp.gmail.com\nSMTP_PORT=465\nSMTP_USER=\nSMTP_PASSWORD=\nEMAIL_FROM=\n`, { flag: 'wx', mode: 0o600 });
  console.log('Configuración creada. Tu clave de la agenda está en ADMIN_PASSWORD dentro de .env.');
}
