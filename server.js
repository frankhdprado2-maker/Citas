import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID, randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { ExcelStore } from './lib/store.js';
import { createMailer, disabledMailer, normalizeEmail, EmailNotifications } from './lib/email.js';

const root = dirname(fileURLToPath(import.meta.url));
export const plans = [
  { id: 'cafe', label: 'Un café y una charla', icon: 'coffee', detail: 'Sin prisa, con buena compañía' },
  { id: 'cine', label: 'Una tarde de cine', icon: 'film', detail: 'Una película y canchita' },
  { id: 'paseo', label: 'Un paseo bonito', icon: 'sun', detail: 'Salir a caminar un rato' },
  { id: 'cena', label: 'Algo rico para comer', icon: 'utensils', detail: 'Elegimos un lugar para comer' },
  { id: 'juegos', label: 'Juegos y risas', icon: 'gamepad', detail: 'Un poquito de competencia' },
  { id: 'sorpresa', label: 'Sorpréndeme', icon: 'gift', detail: 'Tú eliges; yo me apunto' }
];
export const foods = [
  { id: 'pizza', label: 'Pizza', emoji: '🍕' }, { id: 'hamburguesa', label: 'Hamburguesas', emoji: '🍔' },
  { id: 'sushi', label: 'Sushi', emoji: '🍣' }, { id: 'pollo', label: 'Pollo a la brasa', emoji: '🍗' },
  { id: 'pasta', label: 'Pastas', emoji: '🍝' }, { id: 'postre', label: 'Un postrecito', emoji: '🍰' },
  { id: 'cafe', label: 'Café o té', emoji: '☕' }, { id: 'elegimos', label: 'Lo elegimos después', emoji: '✨' }
];
const hash = value => createHash('sha256').update(value).digest('hex');
const safeEqual = (a, b) => timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const publicRecord = record => {
  const { tokenHash, requestId, emailEvent, ...visible } = record;
  return visible;
};
const fail = (status, message) => Object.assign(new Error(message), { status });

export function currentLocal(timezone, instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

function textField(value, label, maximum) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > maximum) throw fail(400, `${label}: usa como máximo ${maximum} caracteres.`);
  return value.trim();
}

function validate(body, timezone) {
  if (!body || typeof body !== 'object') throw fail(400, 'Revisa los datos del plan.');
  const { date, time } = body;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail(400, 'Elige una fecha válida.');
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw fail(400, 'Esa fecha no existe en el calendario.');
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw fail(400, 'Elige una hora válida.');
  const now = currentLocal(timezone);
  if (`${date} ${time}` <= `${now.date} ${now.time}`) throw fail(400, 'Elige una fecha y hora que todavía no hayan pasado.');
  const plan = plans.find(item => item.id === body.plan);
  const food = foods.find(item => item.id === body.food);
  if (!plan || !food) throw fail(400, 'Elige un plan y una opción de comida.');
  const maximum = new Date();
  maximum.setUTCFullYear(maximum.getUTCFullYear() + 2);
  if (date > maximum.toISOString().slice(0, 10)) throw fail(400, 'Elige una fecha dentro de los próximos dos años.');
  let guestEmail;
  try { guestEmail = normalizeEmail(body.guestEmail); }
  catch (error) { throw fail(400, error.message); }
  if (!guestEmail) throw fail(400, 'Escribe tu correo para recibir la confirmación de la salida.');
  return { date, time, plan: plan.label, food: food.label, location: textField(body.location, 'Lugar', 160), note: textField(body.note, 'Comentario', 600), guestEmail, timezone };
}

function calendar(record) {
  const escape = value => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const start = `${record.date.replaceAll('-', '')}T${record.time.replace(':', '')}00`;
  // Hora local sin conversión al huso del navegador. El TZID viaja con el evento.
  const date = new Date(`${record.date}T${record.time}:00Z`);
  date.setUTCHours(date.getUTCHours() + 2);
  const end = date.toISOString().replaceAll('-', '').replaceAll(':', '').slice(0, 15);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Un plan contigo//ES', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${record.id}@unplancontigo`, `DTSTAMP:${new Date().toISOString().replaceAll('-', '').replaceAll(':', '').slice(0, 15)}Z`, `DTSTART;TZID=${record.timezone}:${start}`, `DTEND;TZID=${record.timezone}:${end}`, `SUMMARY:${escape(record.plan)}`, `LOCATION:${escape(record.location || 'Por coordinar')}`, `DESCRIPTION:${escape(`Un plan contigo. Comida: ${record.food}. ${record.note}`)}`, 'END:VEVENT', 'END:VCALENDAR'];
  // RFC 5545: doblar líneas por bytes UTF-8 sin cortar caracteres.
  return lines.map(line => {
    const pieces = []; let piece = '';
    for (const character of line) {
      if (Buffer.byteLength(piece + character) > 73) { pieces.push(piece); piece = ' '; }
      piece += character;
    }
    pieces.push(piece); return pieces.join('\r\n');
  }).join('\r\n') + '\r\n';
}

export async function createApp(options = {}) {
  const timezone = options.timezone || process.env.TIME_ZONE || 'America/Lima';
  currentLocal(timezone);
  const password = options.password || process.env.ADMIN_PASSWORD;
  const secret = options.secret || process.env.SESSION_SECRET;
  if (!password || password.length < 12 || !secret || secret.length < 32) throw new Error('Configura ADMIN_PASSWORD (12+ caracteres) y SESSION_SECRET (32+). Localmente: npm run setup.');
  const directory = resolve(options.directory || process.env.DATA_DIR || resolve(root, 'data', 'registro'));
  if (process.env.RENDER) {
    // Render no publica una variable que certifique el disco. Comprobamos el
    // punto de montaje real en Linux para evitar guardar en el sistema efímero.
    const mounts = (await readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n').map(line => line.split(' ')[4].replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8))));
    if (!mounts.some(mount => mount !== '/' && (directory === mount || directory.startsWith(`${mount}/`)))) throw new Error('DATA_DIR debe estar dentro de un disco montado en Render. Adjunta el disco persistente de render.yaml.');
  }
  const store = new ExcelStore(directory);
  await store.init();
  const mailer = options.email === false ? disabledMailer() : options.mailer || createMailer();
  const notifications = new EmailNotifications(store, mailer);
  await notifications.recover();
  if (options.backgroundEmail !== false) notifications.start();
  const app = express();
  app.disable('x-powered-by');
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { 'default-src': ["'self'"], 'script-src': ["'self'"], 'style-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'connect-src': ["'self'"], 'font-src': ["'self'"], 'object-src': ["'none'"], 'upgrade-insecure-requests': process.env.NODE_ENV === 'production' ? [] : null } } }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin')) {
      try { if (new URL(req.get('origin')).host !== req.get('host')) return next(fail(403, 'Solicitud no permitida.')); }
      catch { return next(fail(403, 'Solicitud no permitida.')); }
    }
    next();
  });
  app.use(express.json({ limit: '12kb' }));
  const jsonLimit = { standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Demasiados intentos. Espera unos minutos y vuelve a probar.' } };
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 150, ...jsonLimit }));
  const bookLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 25, ...jsonLimit });
  const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, ...jsonLimit });

  const sign = payload => createHmac('sha256', secret).update(payload).digest('base64url');
  function requireAdmin(req, res, next) {
    const cookie = (req.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith('agenda_session='));
    const [payload, signature] = (cookie?.slice('agenda_session='.length) || '').split('.');
    if (!payload || !signature || !safeEqual(sign(payload), signature)) return next(fail(401, 'Ingresa tu clave para abrir la agenda.'));
    try { if (JSON.parse(Buffer.from(payload, 'base64url')).expires <= Date.now()) return next(fail(401, 'Tu sesión terminó. Ingresa nuevamente.')); }
    catch { return next(fail(401, 'Ingresa nuevamente.')); }
    next();
  }
  function guestRecord(records, req) {
    const record = records.find(item => item.id === req.params.id);
    const token = req.get('x-booking-token') || '';
    if (!record || token.length > 128 || !safeEqual(record.tokenHash, hash(token))) throw fail(404, 'No encontramos ese plan. Vuelve a abrir tu confirmación original.');
    return record;
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/config', (_req, res) => res.json({ timezone, now: currentLocal(timezone), plans, foods }));
  app.post('/api/appointments', bookLimit, async (req, res) => {
    const data = validate(req.body, timezone);
    const requestId = textField(req.body.requestId, 'Identificador', 40);
    if (!/^[a-f0-9-]{36}$/.test(requestId)) throw fail(400, 'Recarga la invitación y vuelve a intentar.');
    // El token enviado por el navegador también permite reintentar sin crear duplicados.
    const token = textField(req.body.token, 'Confirmación', 100);
    if (!/^[a-f0-9]{64}$/.test(token)) throw fail(400, 'Recarga la invitación y vuelve a intentar.');
    const result = await store.mutate((records, jobs) => {
      const existing = records.find(item => item.requestId === requestId);
      if (existing) {
        if (!safeEqual(existing.tokenHash, hash(token))) throw fail(409, 'Ese envío ya fue registrado.');
        return { record: existing, created: false };
      }
      if (records.some(item => item.status === 'Confirmada' && item.date === data.date && item.time === data.time)) throw fail(409, 'Ya hay un plan a esa hora. Elige otra hora o reprograma el anterior.');
      const timestamp = new Date().toISOString();
      const record = { id: randomUUID(), ...data, status: 'Confirmada', createdAt: timestamp, updatedAt: timestamp, tokenHash: hash(token), requestId };
      records.push(record);
      notifications.enqueue(record, jobs, 'Agendada');
      return { record, created: true };
    });
    notifications.kick();
    res.status(result.created ? 201 : 200).json({ appointment: publicRecord(result.record) });
  });
  app.get('/api/appointments/:id', async (req, res) => res.json({ appointment: publicRecord(guestRecord(await store.list(), req)) }));
  app.patch('/api/appointments/:id', async (req, res) => {
    const record = await store.mutate((records, jobs) => {
      const item = guestRecord(records, req);
      if (item.status !== 'Confirmada') throw fail(409, 'Ese plan ya terminó o fue cancelado. Puedes crear una nueva invitación.');
      const data = validate({ ...req.body, guestEmail: req.body?.guestEmail === undefined ? item.guestEmail : req.body.guestEmail }, timezone);
      if (records.some(other => other.id !== item.id && other.status === 'Confirmada' && other.date === data.date && other.time === data.time)) throw fail(409, 'Ya hay un plan a esa hora. Elige otro horario.');
      const changed = Object.entries(data).some(([key, value]) => item[key] !== value);
      Object.assign(item, data, { updatedAt: new Date().toISOString() });
      if (changed) notifications.enqueue(item, jobs, 'Reprogramada');
      return item;
    });
    notifications.kick();
    res.json({ appointment: publicRecord(record) });
  });
  app.post('/api/appointments/:id/cancel', async (req, res) => {
    const record = await store.mutate((records, jobs) => {
      const item = guestRecord(records, req);
      if (item.status === 'Realizada') throw fail(409, 'Esta salida ya figura como realizada.');
      if (item.status !== 'Cancelada') {
        item.status = 'Cancelada'; item.updatedAt = new Date().toISOString();
        notifications.enqueue(item, jobs, 'Cancelada');
      }
      return item;
    });
    notifications.kick();
    res.json({ appointment: publicRecord(record) });
  });
  app.get('/api/appointments/:id/calendar', async (req, res) => {
    const record = guestRecord(await store.list(), req);
    if (record.status === 'Cancelada') throw fail(409, 'El plan está cancelado.');
    res.type('text/calendar').attachment('nuestro-plan.ics').send(calendar(record));
  });

  app.post('/api/admin/login', loginLimit, (req, res) => {
    if (typeof req.body?.password !== 'string' || req.body.password.length > 200 || !safeEqual(req.body.password, password)) throw fail(401, 'La clave no es correcta.');
    const payload = Buffer.from(JSON.stringify({ expires: Date.now() + 12 * 60 * 60 * 1000, nonce: randomBytes(12).toString('hex') })).toString('base64url');
    res.cookie('agenda_session', `${payload}.${sign(payload)}`, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 12 * 60 * 60 * 1000, path: '/api/admin' });
    res.json({ ok: true });
  });
  app.post('/api/admin/logout', (_req, res) => { res.clearCookie('agenda_session', { path: '/api/admin' }); res.json({ ok: true }); });
  app.get('/api/admin/appointments', requireAdmin, async (_req, res) => {
    const { records, notifications: jobs } = await store.state();
    res.json({ appointments: records.map(publicRecord), timezone, email: { configured: mailer.configured, ownerEmail: mailer.ownerEmail, reason: mailer.reason || '' }, notifications: jobs.map(({ snapshot, eventId, ...visible }) => visible) });
  });
  app.post('/api/admin/email/verify', requireAdmin, async (_req, res) => {
    if (!mailer.configured) throw fail(409, mailer.reason || 'Activa el correo primero.');
    try { await mailer.verify(); res.json({ ok: true, message: 'Conexión y acceso al correo comprobados. No se envió ningún mensaje.' }); }
    catch { throw fail(409, 'No pudimos acceder a Gmail. Revisa la contraseña de aplicación, SMTP_USER y la conexión del servidor.'); }
  });
  app.post('/api/admin/storage/verify', requireAdmin, async (_req, res) => {
    await store.mutate(() => undefined);
    res.json({ ok: true, message: 'Registro disponible para guardar las salidas.' });
  });
  app.post('/api/admin/appointments/:id/email/retry', requireAdmin, async (req, res) => {
    await notifications.retry(req.params.id, req.body?.confirmUncertain === true);
    res.json({ ok: true });
  });
  app.patch('/api/admin/appointments/:id', requireAdmin, async (req, res) => {
    if (!['Confirmada', 'Realizada', 'Cancelada'].includes(req.body?.status)) throw fail(400, 'Estado no válido.');
    const record = await store.mutate((records, jobs) => {
      const item = records.find(row => row.id === req.params.id);
      if (!item) throw fail(404, 'No encontramos esa salida.');
      if (req.body.status === 'Confirmada' && records.some(other => other.id !== item.id && other.status === 'Confirmada' && other.date === item.date && other.time === item.time)) throw fail(409, 'Ese horario ya está ocupado.');
      const changed = item.status !== req.body.status;
      item.status = req.body.status; item.updatedAt = new Date().toISOString();
      if (changed && item.status === 'Cancelada') notifications.enqueue(item, jobs, 'Cancelada');
      if (changed && item.status === 'Confirmada') notifications.enqueue(item, jobs, 'Agendada');
      return item;
    });
    notifications.kick();
    res.json({ appointment: publicRecord(record) });
  });
  app.get('/api/admin/excel', requireAdmin, async (_req, res) => res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('citas.xlsx').send(await store.snapshot()));
  app.get('/agenda', (_req, res) => res.redirect(302, '/'));
  app.use(express.static(resolve(root, 'public'), { index: 'index.html' }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'No encontramos esa opción.' }));
  app.use((error, _req, res, _next) => {
    const status = error.status || (error.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error('Error de agenda:', error.message);
    res.status(status).json({ error: error.code === 'EXCEL_LOCKED' || status < 500 ? error.message : 'No pudimos guardar el plan. Intenta otra vez; tu confirmación aparecerá solo cuando esté guardada.' });
  });
  return { app, store, notifications };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { app, notifications } = await createApp();
    const server = app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`Un plan contigo → http://localhost:${server.address().port}`));
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(async () => { await notifications.stop(); process.exit(0); }); });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
