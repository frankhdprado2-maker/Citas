import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
import { createApp, currentLocal } from '../server.js';

const password = 'clave-solo-para-pruebas-1234';
const secret = 'secreto-solo-para-pruebas-con-32-caracteres';
function nextDate() { const date = new Date(); date.setUTCDate(date.getUTCDate() + 3); return date.toISOString().slice(0, 10); }
function payload(overrides = {}) { return { date: nextDate(), time: '18:00', plan: 'cafe', food: 'pizza', location: 'Café de prueba', note: '=HYPERLINK("https://example.org","Texto de prueba")', guestEmail: 'invitada@example.com', requestId: randomUUID(), token: randomBytes(32).toString('hex'), ...overrides }; }

test('Agenda completa: validación, acceso, Excel, concurrencia y persistencia', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'citas-test-'));
  const options = { directory, password, secret, timezone: 'America/Lima', email: false };
  const { app, store } = await createApp(options);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', body, headers = {}) => fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  context.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  let booking, first, cookie;

  await context.test('El huso de Lima se respeta alrededor de medianoche', () => {
    assert.deepEqual(currentLocal('America/Lima', new Date('2026-10-13T03:30:00Z')), { date: '2026-10-12', time: '22:30' });
  });
  await context.test('Páginas disponibles y datos privados protegidos', async () => {
    assert.equal((await request('/')).status, 200);
    const oldAgenda = await fetch(`${base}/agenda`, { redirect: 'manual' });
    assert.equal(oldAgenda.status, 302);
    assert.equal(oldAgenda.headers.get('location'), '/');
    assert.equal((await request('/agenda.html')).status, 404);
    assert.equal((await request('/admin.js')).status, 404);
    assert.equal((await request('/api/admin/appointments')).status, 401);
    assert.equal((await request('/api/admin/excel')).status, 401);
    assert.equal((await request('/data/citas.xlsx')).status, 404);
    const config = await (await request('/api/config')).json();
    assert.equal(config.timezone, 'America/Lima');
    assert.equal(config.plans.length, 6);
  });
  await context.test('Rechaza fechas pasadas/imposibles, horas y códigos inválidos', async () => {
    for (const patch of [{ date: '2026-02-30' }, { date: '2000-01-01' }, { date: '2026-13-01' }, { time: '25:00' }, { plan: 'inventado' }, { food: 'inventada' }, { note: 'a'.repeat(601) }]) {
      assert.equal((await request('/api/appointments', 'POST', payload(patch))).status, 400);
    }
    assert.equal((await request('/api/appointments', 'POST', payload(), { Origin: 'https://otra-web.example' })).status, 403);
  });
  await context.test('Guarda una confirmación real y los reintentos no la duplican', async () => {
    first = payload();
    const response = await request('/api/appointments', 'POST', first);
    assert.equal(response.status, 201);
    booking = (await response.json()).appointment;
    assert.equal(booking.status, 'Confirmada');
    assert.equal(booking.tokenHash, undefined);
    assert.equal(booking.requestId, undefined);
    assert.equal((await request('/api/appointments', 'POST', first)).status, 200);
    assert.equal((await store.list()).length, 1);
    assert.equal((await request('/api/appointments', 'POST', payload())).status, 409);
    assert.equal((await request(`/api/appointments/${booking.id}`)).status, 404);
    assert.equal((await request(`/api/appointments/${booking.id}`, 'GET', null, { 'X-Booking-Token': first.token })).status, 200);
  });
  await context.test('Descarga calendario con fecha y zona horaria correctas', async () => {
    const response = await request(`/api/appointments/${booking.id}/calendar`, 'GET', null, { 'X-Booking-Token': first.token });
    const calendar = await response.text();
    assert.match(calendar, /BEGIN:VCALENDAR/);
    assert.ok(calendar.includes(`DTSTART;TZID=America/Lima:${first.date.replaceAll('-', '')}T180000`));
    assert.ok(calendar.includes(`DTEND;TZID=America/Lima:${first.date.replaceAll('-', '')}T200000`));
    assert.ok(calendar.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  });
  await context.test('La cola conserva todos los envíos simultáneos', async () => {
    const responses = await Promise.all([19, 20, 21, 22].map(hour => request('/api/appointments', 'POST', payload({ time: `${hour}:00` }))));
    assert.deepEqual(responses.map(response => response.status), [201, 201, 201, 201]);
    assert.equal((await store.list()).length, 5);
  });
  await context.test('El Excel es legible, formateado y no convierte texto en fórmulas', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(store.path);
    const sheet = workbook.getWorksheet('Citas');
    assert.equal(sheet.rowCount, 6);
    assert.equal(sheet.getCell('G2').value, first.note);
    assert.equal(sheet.getCell('G2').type, ExcelJS.ValueType.String);
    assert.equal(sheet.views[0].state, 'frozen');
    assert.equal(sheet.getColumn(12).hidden, true);
    assert.ok((await readFile(`${store.path}.bak`)).length > 100);
  });
  await context.test('Una nueva instancia recupera los datos exclusivamente del Excel', async () => {
    const restarted = await createApp(options);
    assert.equal((await restarted.store.list()).length, 5);
  });
  await context.test('Reprograma con el token y cancela sin borrar el historial', async () => {
    const headers = { 'X-Booking-Token': first.token };
    assert.equal((await request(`/api/appointments/${booking.id}`, 'PATCH', { ...first, time: '19:00' }, headers)).status, 409);
    const changed = await request(`/api/appointments/${booking.id}`, 'PATCH', { ...first, time: '17:30', food: 'postre' }, headers);
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).appointment.time, '17:30');
    assert.equal((await request(`/api/appointments/${booking.id}/cancel`, 'POST', null, headers)).status, 200);
    assert.equal((await request(`/api/appointments/${booking.id}/calendar`, 'GET', null, headers)).status, 409);
    assert.equal((await request(`/api/appointments/${booking.id}`, 'PATCH', first, headers)).status, 409);
    assert.equal((await store.list()).length, 5);
    assert.equal((await store.list())[0].status, 'Cancelada');
  });
  await context.test('El dueño inicia sesión, cambia estados y descarga el Excel', async () => {
    assert.equal((await request('/api/admin/login', 'POST', { password: 'incorrecta' })).status, 401);
    const response = await request('/api/admin/login', 'POST', { password });
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie').split(';')[0];
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    assert.match(response.headers.get('set-cookie'), /SameSite=Strict/);
    const listed = await request('/api/admin/appointments', 'GET', null, { Cookie: cookie });
    assert.equal((await listed.json()).appointments.length, 5);
    assert.equal((await request(`/api/admin/appointments/${booking.id}`, 'PATCH', { status: 'Realizada' }, { Cookie: cookie })).status, 200);
    assert.equal((await request(`/api/appointments/${booking.id}/cancel`, 'POST', null, { 'X-Booking-Token': first.token })).status, 409);
    assert.equal((await request(`/api/appointments/${booking.id}`, 'PATCH', first, { 'X-Booking-Token': first.token })).status, 409);
    const downloaded = await request('/api/admin/excel', 'GET', null, { Cookie: cookie });
    assert.equal(downloaded.status, 200);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await downloaded.arrayBuffer()));
    assert.equal(workbook.getWorksheet('Citas').getCell('H2').value, 'Realizada');
    const tampered = cookie.replace(/.$/, cookie.endsWith('a') ? 'b' : 'a');
    assert.equal((await request('/api/admin/appointments', 'GET', null, { Cookie: tampered })).status, 401);
  });
  await context.test('Un archivo dañado no se reemplaza por una agenda vacía', async () => {
    const damaged = await mkdtemp(join(tmpdir(), 'citas-corrupt-'));
    try {
      await writeFile(join(damaged, 'citas.xlsx'), 'archivo dañado');
      await assert.rejects(createApp({ ...options, directory: damaged }));
      assert.equal(await readFile(join(damaged, 'citas.xlsx'), 'utf8'), 'archivo dañado');
    } finally { await rm(damaged, { recursive: true, force: true }); }
  });
});
