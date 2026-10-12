import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import ExcelJS from 'exceljs';
import { createApp } from '../server.js';
import { createMailer, buildEmail, normalizeEmail, EmailNotifications } from '../lib/email.js';
import { ExcelStore } from '../lib/store.js';

const password = 'clave-de-la-agenda-para-tests';
const secret = 'secreto-de-la-agenda-para-tests-123456789';
function payload(patch = {}) {
  const date = new Date(); date.setUTCDate(date.getUTCDate() + 5);
  return { date: date.toISOString().slice(0, 10), time: '17:15', plan: 'cine', food: 'postre', location: 'Café & <parque>', note: '<img src=x onerror=alert(1)>', guestEmail: 'ella@example.com', token: randomBytes(32).toString('hex'), requestId: randomUUID(), ...patch };
}
async function fixture(context, mailer) {
  const directory = await mkdtemp(join(tmpdir(), 'citas-email-test-'));
  const result = await createApp({ directory, password, secret, mailer, backgroundEmail: false });
  const server = result.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  context.after(async () => { await result.notifications.stop(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', body, headers = {}) => fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  async function login() { const response = await request('/api/admin/login', 'POST', { password }); return { Cookie: response.headers.get('set-cookie').split(';')[0] }; }
  return { ...result, directory, request, login };
}
function smtpMailbox() {
  const messages = [];
  const server = createServer(socket => {
    socket.setEncoding('utf8'); socket.write('220 pruebas.local ESMTP\r\n');
    let buffer = '', inData = false, lines = [], recipients = [];
    socket.on('data', data => {
      buffer += data;
      let index;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === '.') { messages.push({ recipients: [...recipients], raw: lines.join('\r\n') }); inData = false; lines = []; socket.write('250 Message accepted\r\n'); }
          else lines.push(line.replace(/^\.\./, '.'));
        } else if (/^EHLO/.test(line)) socket.write('250-pruebas.local\r\n250 SIZE 1000000\r\n');
        else if (/^HELO/.test(line)) socket.write('250 pruebas.local\r\n');
        else if (/^MAIL FROM:/.test(line)) { recipients = []; socket.write('250 OK\r\n'); }
        else if (/^RCPT TO:/.test(line)) { recipients.push(line.match(/<([^>]+)>/)[1]); socket.write('250 OK\r\n'); }
        else if (line === 'DATA') { inData = true; socket.write('354 End with dot\r\n'); }
        else if (line === 'QUIT') { socket.end('221 Bye\r\n'); }
        else socket.write('250 OK\r\n');
      }
    });
  });
  return { server, messages };
}

test('Valida correos y escapa los detalles en el mensaje', () => {
  assert.equal(normalizeEmail(' ella@example.com '), 'ella@example.com');
  for (const value of ['correo', 'a..b@example.com', '.a@example.com', 'a@example', 'a@example.com\r\nBcc:otro@example.com', ['a@example.com']]) assert.throws(() => normalizeEmail(value));
  const message = buildEmail({ ...payload(), plan: 'Una tarde de cine', food: 'Un postrecito', timezone: 'America/Lima' });
  assert.ok(message.html.includes('&lt;img'));
  assert.ok(!message.html.includes('<img src=x'));
  assert.match(message.subject, /Salida agendada/);
  assert.match(message.text, /America\/Lima/);
  assert.ok(!message.text.includes('token'));
  assert.ok(!message.html.includes('requestId'));
  for (const kind of ['Agendada', 'Reprogramada', 'Cancelada']) {
    const variant = buildEmail({ ...payload(), plan: 'Café & charla', timezone: 'America/Lima' }, kind);
    assert.ok(variant.html.includes('Café &amp; charla'));
    assert.ok(variant.html.includes('Café &amp; &lt;parque&gt;'));
    assert.ok(variant.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.match(variant.text, /Café & charla/);
    assert.match(variant.text, /America\/Lima/);
    assert.match(variant.subject, new RegExp(kind === 'Agendada' ? 'agendada' : kind === 'Reprogramada' ? 'reprogramada' : 'cancelada'));
    assert.ok(!variant.html.includes('<img src=x'));
  }
});

test('Envía dos confirmaciones SMTP reales a un buzón local de prueba, sin correos externos', async context => {
  const mailbox = smtpMailbox(); mailbox.server.listen(0, '127.0.0.1');
  await new Promise(resolve => mailbox.server.once('listening', resolve));
  context.after(() => new Promise(resolve => mailbox.server.close(resolve)));
  const transport = nodemailer.createTransport({ host: '127.0.0.1', port: mailbox.server.address().port, secure: false, ignoreTLS: true, disableFileAccess: true, disableUrlAccess: true });
  const mailer = createMailer({ OWNER_EMAIL: 'dueno@example.com', SMTP_USER: 'remitente@example.com', SMTP_PASSWORD: 'solo-pruebas', EMAIL_FROM: 'Un plan contigo <remitente@example.com>' }, { transport });
  const f = await fixture(context, mailer);
  const first = payload();
  const response = await f.request('/api/appointments', 'POST', first);
  assert.equal(response.status, 201);
  const booking = (await response.json()).appointment;
  await f.notifications.kick();
  assert.equal(mailbox.messages.length, 2);
  assert.deepEqual(mailbox.messages.map(message => message.recipients), [['dueno@example.com'], ['ella@example.com']]);
  const state = await f.store.state();
  assert.equal(state.records[0].emailStatus, 'Aceptado');
  assert.equal(state.notifications.length, 2);
  assert.ok(state.notifications.every(job => job.status === 'Aceptado' && job.messageId));
  await f.request('/api/appointments', 'POST', first);
  await f.notifications.kick();
  assert.equal(mailbox.messages.length, 2);
  const auth = await f.login();
  assert.equal((await f.request('/api/admin/email/verify', 'POST', null, auth)).status, 200);
  assert.equal(mailbox.messages.length, 2);
  assert.equal((await f.request(`/api/admin/appointments/${booking.id}/email/retry`, 'POST', {}, auth)).status, 200);
  await f.notifications.kick();
  assert.equal(mailbox.messages.length, 2);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(f.store.path);
  assert.equal(workbook.getWorksheet('Citas').getCell('N2').value, 'ella@example.com');
  assert.equal(workbook.getWorksheet('Avisos').rowCount, 3);
  assert.equal((await f.request('/api/admin/appointments')).status, 401);
  assert.equal((await f.request('/api/admin/email/verify', 'POST')).status, 401);
  assert.equal((await f.request(`/api/admin/appointments/${booking.id}/email/retry`, 'POST')).status, 401);
  const restarted = new EmailNotifications(f.store, mailer);
  await restarted.recover(); await restarted.kick();
  assert.equal(mailbox.messages.length, 2);
});

test('Sin contraseña SMTP guarda la salida y ambos avisos pendientes, sin inventar envíos', async context => {
  const mailer = createMailer({ OWNER_EMAIL: 'dueno@example.com', SMTP_USER: 'remitente@example.com' });
  const f = await fixture(context, mailer);
  const response = await f.request('/api/appointments', 'POST', payload());
  assert.equal(response.status, 201);
  const booking = (await response.json()).appointment;
  assert.equal(booking.emailStatus, 'Sin configurar');
  const state = await f.store.state();
  assert.equal(state.records.length, 1);
  assert.equal(state.notifications.length, 2);
  assert.ok(state.notifications.every(job => job.status === 'Sin configurar'));
  const config = await (await f.request('/api/config')).json();
  assert.equal(config.ownerEmail, undefined);
  assert.equal((await f.request('/api/appointments', 'POST', payload({ guestEmail: 'mal@correo' }))).status, 400);
});

test('Exige correo al agendar y editar, conserva direcciones existentes y permite cancelar planes antiguos', async context => {
  const f = await fixture(context, { configured: false, ownerEmail: 'dueno@example.com' });
  const invalid = [undefined, null, '', '   ', 'sin-correo', 'a@example.com\r\nBcc:otro@example.com'];
  for (const guestEmail of invalid) {
    assert.equal((await f.request('/api/appointments', 'POST', payload({ guestEmail }))).status, 400);
  }
  assert.deepEqual(await f.store.state(), { records: [], notifications: [] });
  const first = payload({ guestEmail: ' ella@example.com ' });
  const response = await f.request('/api/appointments', 'POST', first);
  assert.equal(response.status, 201);
  const booking = (await response.json()).appointment;
  assert.equal(booking.guestEmail, 'ella@example.com');
  const headers = { 'X-Booking-Token': first.token };
  for (const guestEmail of [null, '', '   ', 'mal@correo']) {
    assert.equal((await f.request(`/api/appointments/${booking.id}`, 'PATCH', { ...first, guestEmail }, headers)).status, 400);
  }
  assert.equal((await f.store.list())[0].guestEmail, 'ella@example.com');
  assert.equal((await f.store.state()).notifications.length, 2);
  const { guestEmail, ...withoutEmail } = first;
  const changed = await f.request(`/api/appointments/${booking.id}`, 'PATCH', { ...withoutEmail, time: '18:30' }, headers);
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).appointment.guestEmail, 'ella@example.com');
  // Los registros creados antes de exigir correo siguen siendo consultables y cancelables.
  await f.store.mutate(records => { records[0].guestEmail = ''; });
  assert.equal((await f.request(`/api/appointments/${booking.id}`, 'GET', null, headers)).status, 200);
  assert.equal((await f.request(`/api/appointments/${booking.id}`, 'PATCH', withoutEmail, headers)).status, 400);
  assert.equal((await f.request(`/api/appointments/${booking.id}/cancel`, 'POST', null, headers)).status, 200);
});

test('Un Excel bloqueado conserva los datos y el reintento guarda una sola salida', async context => {
  const f = await fixture(context, { configured: false, ownerEmail: 'dueno@example.com' });
  const original = await f.store.snapshot();
  f.store.replaceFile = async () => { throw Object.assign(new Error('Archivo abierto en Excel'), { code: 'EPERM' }); };
  const first = payload();
  const blocked = await f.request('/api/appointments', 'POST', first);
  assert.equal(blocked.status, 503);
  assert.match((await blocked.json()).error, /registro está ocupado/);
  assert.deepEqual(await f.store.snapshot(), original);
  assert.deepEqual(await f.store.state(), { records: [], notifications: [] });
  f.store.replaceFile = rename;
  assert.equal((await f.request('/api/appointments', 'POST', first)).status, 201);
  assert.equal((await f.request('/api/appointments', 'POST', first)).status, 200);
  assert.equal((await f.store.state()).records.length, 1);
  assert.equal((await f.store.state()).notifications.length, 2);
  assert.equal((await f.request('/api/admin/storage/verify', 'POST')).status, 401);
  const beforeCheck = await f.store.state();
  assert.equal((await f.request('/api/admin/storage/verify', 'POST', null, await f.login())).status, 200);
  assert.deepEqual(await f.store.state(), beforeCheck);
});

test('Un bloqueo breve del archivo se recupera sin pedir otro envío ni duplicar avisos', async context => {
  const f = await fixture(context, { configured: false, ownerEmail: 'dueno@example.com' });
  let attempts = 0;
  f.store.replaceFile = async (source, destination) => {
    if (++attempts < 3) throw Object.assign(new Error('Bloqueo temporal'), { code: 'EBUSY' });
    return rename(source, destination);
  };
  assert.equal((await f.request('/api/appointments', 'POST', payload())).status, 201);
  assert.equal(attempts, 3);
  assert.equal((await f.store.state()).records.length, 1);
  assert.equal((await f.store.state()).notifications.length, 2);
});

test('Errores y reintentos no borran citas ni repiten destinatarios ya aceptados', async context => {
  const attempts = [];
  let failGuest = true;
  const mailer = { configured: true, ownerEmail: 'dueno@example.com', reason: '', send: async job => {
    attempts.push(job.recipient);
    if (job.recipient === 'ella@example.com' && failGuest) throw Object.assign(new Error('Prueba de rechazo de acceso'), { code: 'EAUTH' });
    return { messageId: job.id };
  } };
  const f = await fixture(context, mailer);
  const response = await f.request('/api/appointments', 'POST', payload());
  const booking = (await response.json()).appointment;
  await f.notifications.kick();
  assert.equal((await f.store.list())[0].status, 'Confirmada');
  assert.equal((await f.store.list())[0].emailStatus, 'Error');
  const auth = await f.login();
  failGuest = false;
  await f.request(`/api/admin/appointments/${booking.id}/email/retry`, 'POST', {}, auth);
  await f.notifications.kick();
  assert.deepEqual(attempts, ['dueno@example.com', 'ella@example.com', 'ella@example.com']);
  assert.equal((await f.store.list())[0].emailStatus, 'Aceptado');
});

test('Un resultado incierto tras DATA no se reenvía solo y requiere revisar el buzón', async context => {
  let calls = 0;
  const mailer = { configured: true, ownerEmail: 'dueno@example.com', send: async () => { calls++; throw Object.assign(new Error('Timeout de prueba'), { code: 'ETIMEDOUT', command: 'DATA' }); } };
  const f = await fixture(context, mailer);
  const response = await f.request('/api/appointments', 'POST', payload({ guestEmail: 'dueno@example.com' }));
  const booking = (await response.json()).appointment;
  await f.notifications.kick(); await f.notifications.kick();
  assert.equal(calls, 1);
  assert.equal((await f.store.list())[0].emailStatus, 'Revisar');
  const auth = await f.login();
  assert.equal((await f.request(`/api/admin/appointments/${booking.id}/email/retry`, 'POST', {}, auth)).status, 409);
  assert.equal(calls, 1);
});

test('Al activar el correo se envía solo el estado vigente de una salida cancelada', async context => {
  const sent = [];
  const mailer = { configured: false, ownerEmail: 'dueno@example.com', send: async job => { sent.push(job); return { messageId: job.id }; } };
  const f = await fixture(context, mailer);
  const first = payload();
  const booking = (await (await f.request('/api/appointments', 'POST', first)).json()).appointment;
  const headers = { 'X-Booking-Token': first.token };
  await f.request(`/api/appointments/${booking.id}`, 'PATCH', { ...first, time: '18:30' }, headers);
  await f.request(`/api/appointments/${booking.id}/cancel`, 'POST', null, headers);
  await f.request(`/api/appointments/${booking.id}/cancel`, 'POST', null, headers);
  const state = await f.store.state();
  assert.equal(state.notifications.length, 6);
  assert.equal(state.notifications.filter(job => job.status === 'Obsoleto').length, 4);
  mailer.configured = true;
  await f.notifications.kick();
  assert.equal(sent.length, 2);
  assert.ok(sent.every(job => job.kind === 'Cancelada' && JSON.parse(job.snapshot).time === '18:30'));
  assert.equal((await f.store.list())[0].status, 'Cancelada');
});

test('Migra un Excel anterior de 13 columnas conservando citas y claves de acceso', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'citas-migration-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const original = new ExcelJS.Workbook();
  const sheet = original.addWorksheet('Citas');
  sheet.addRow(['Identificador', 'Fecha', 'Hora', 'Plan', 'Comida', 'Lugar', 'Comentario', 'Estado', 'Registro (UTC)', 'Actualización (UTC)', 'Zona horaria', 'Control de acceso', 'Control de envío']);
  sheet.addRow(['id-anterior', '2026-12-01', '17:00', 'Un café y una charla', 'Pizza', '', 'Nota original', 'Confirmada', '', '', 'America/Lima', 'hash-anterior', 'envio-anterior']);
  await original.xlsx.writeFile(join(directory, 'citas.xlsx'));
  const store = new ExcelStore(directory); await store.init();
  const records = await store.list();
  assert.equal(records[0].tokenHash, 'hash-anterior');
  assert.equal(records[0].guestEmail, '');
  await store.mutate(items => { items[0].guestEmail = 'ella@example.com'; });
  const upgraded = await store.state();
  assert.equal(upgraded.records[0].note, 'Nota original');
  assert.equal(upgraded.records[0].requestId, 'envio-anterior');
  assert.equal(upgraded.records[0].guestEmail, 'ella@example.com');
  assert.equal(upgraded.notifications.length, 0);
});
