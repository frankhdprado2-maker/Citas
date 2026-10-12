import 'dotenv/config';
import { createMailer } from '../lib/email.js';

const mailer = createMailer();
try {
  if (!mailer.configured) throw new Error(mailer.reason);
  await mailer.verify();
  console.log('Conexión y acceso a Gmail comprobados. No se envió ningún mensaje.');
} catch (error) {
  console.error(mailer.configured ? 'No pudimos acceder a Gmail. Revisa SMTP_USER, la contraseña de aplicación y la conexión.' : error.message);
  process.exitCode = 1;
} finally { mailer.close?.(); }
