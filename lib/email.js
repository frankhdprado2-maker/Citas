import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const pendingStates = ['Pendiente', 'Sin configurar'];
export function normalizeEmail(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new Error('Escribe un correo válido.');
  const email = value.trim();
  if (email.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(email) || email.startsWith('.') || email.split('@')[0].endsWith('.') || email.includes('..')) throw new Error('Escribe un correo válido, por ejemplo nombre@gmail.com.');
  return email;
}

export function disabledMailer() { return { configured: false, ownerEmail: '', from: '', reason: 'Falta configurar el envío de correo.' }; }
export function createMailer(environment = process.env, options = {}) {
  let ownerEmail = '', from = '', reason = '';
  try { ownerEmail = normalizeEmail(environment.OWNER_EMAIL); }
  catch { reason = 'Revisa OWNER_EMAIL: el destinatario del dueño no es válido.'; }
  const user = (environment.SMTP_USER || '').trim();
  const password = environment.SMTP_PASSWORD || '';
  from = (environment.EMAIL_FROM || user).trim();
  const port = Number(environment.SMTP_PORT || 465);
  const missing = [!ownerEmail && 'OWNER_EMAIL', !user && 'SMTP_USER', !password && 'SMTP_PASSWORD', !from && 'EMAIL_FROM'].filter(Boolean);
  if (!reason && missing.length) reason = `Completa ${missing.join(', ')} en tu configuración privada.`;
  if (!reason && (!([465, 587].includes(port)) || /[\r\n]/.test(from) || from.length > 320)) reason = 'Revisa el remitente y SMTP_PORT (465 o 587).';
  if (!reason) {
    try { normalizeEmail(user); normalizeEmail(from.match(/<([^<>]+)>$/)?.[1] || from); }
    catch { reason = 'Revisa el correo del remitente en SMTP_USER y EMAIL_FROM.'; }
  }
  if (reason) return { configured: false, ownerEmail, from, reason };
  const transporter = options.transport || nodemailer.createTransport({
    host: environment.SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465,
    requireTLS: port === 587, auth: { user, pass: password },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    dnsTimeout: 10000, disableFileAccess: true, disableUrlAccess: true,
    logger: false, debug: false
  });
  return {
    configured: true, ownerEmail, from, reason: '',
    async send(job) {
      const snapshot = JSON.parse(job.snapshot);
      const message = buildEmail(snapshot, job.kind);
      const result = await transporter.sendMail({ from, to: job.recipient, messageId: `<${job.id}@unplancontigo.local>`, ...message });
      if (!result.accepted?.length) throw Object.assign(new Error('El servidor no aceptó el destinatario.'), { code: 'EENVELOPE' });
      return { messageId: result.messageId };
    },
    verify: () => transporter.verify(),
    close: () => transporter.close()
  };
}

export function buildEmail(record, kind = 'Agendada') {
  const canceled = kind === 'Cancelada';
  const changed = kind === 'Reprogramada';
  const heading = canceled ? 'Lo dejamos para otro día.' : changed ? 'Actualizamos nuestro plan' : '¡Nos vemos pronto!';
  const label = canceled ? 'SALIDA CANCELADA' : changed ? 'PLAN ACTUALIZADO' : 'PLAN CONFIRMADO';
  const intro = canceled ? 'Esta salida quedó cancelada. Cuando se pueda, buscamos otro momento.' : changed ? 'Cambiaron algunos detalles, pero las ganas de compartir un rato siguen aquí.' : 'Ya tenemos un día para vernos. Un buen plan y un ratito para conocernos un poco más.';
  const closing = canceled ? 'Será en otro momento.' : 'Me hace ilusión compartir este rato contigo.';
  const instant = new Date(`${record.date}T12:00:00Z`);
  const formatDate = options => new Intl.DateTimeFormat('es-PE', { ...options, timeZone: 'UTC' }).format(instant);
  const date = formatDate({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const day = formatDate({ day: 'numeric' });
  const weekday = formatDate({ weekday: 'long' });
  const month = formatDate({ month: 'long', year: 'numeric' });
  const time = new Intl.DateTimeFormat('es-PE', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(new Date(`2026-01-01T${record.time}:00Z`));
  const timezone = record.timezone || 'America/Lima';
  const timezoneLabel = timezone === 'America/Lima' ? 'Hora de Lima' : timezone;
  const rows = [['Día', date], ['Hora', `${time} · ${timezone}`], ['Plan', record.plan], ['Comida', record.food], ['Lugar', record.location || 'Lo coordinamos después']];
  if (record.note) rows.push(['Comentario', record.note]);
  const text = `${label}\n${heading}\n\n${intro}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join('\n')}\n\n${closing}\n\nUn plan contigo\n`;
  const details = [['ALGO RICO', record.food], ['EL LUGAR', record.location || 'Lo coordinamos después']];
  const accent = canceled ? '#967368' : '#64785b';
  const tint = canceled ? '#f3ebe6' : '#edf2e7';
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading}</title>
<style>@media screen and (max-width:480px){.email-pad{padding:26px 20px!important}.email-title{font-size:32px!important}.date-cell{display:block!important;width:auto!important;padding:0 0 18px!important}.time-cell{display:block!important;width:auto!important;border-left:0!important;border-top:1px solid #dce4d4!important;padding:18px 0 0!important;text-align:left!important}.date-number{width:58px!important}.email-detail{display:block!important;width:auto!important;padding:0 0 16px!important}.detail-last{padding-bottom:0!important}}</style>
</head><body style="margin:0;padding:0;background:#f7f4ee;color:#39423a;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f7f4ee">${escape(`${label.toLowerCase()} · ${date} a las ${time}. ${record.plan}.`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#f7f4ee"><tr><td align="center" style="padding:30px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;border-collapse:separate;border-spacing:0">
<tr><td class="email-pad" align="center" style="padding:32px 36px 30px;background:${tint};border:1px solid #e0e5d9;border-bottom:0;border-radius:22px 22px 0 0">
  <div style="font-size:34px;line-height:48px;margin-bottom:14px" aria-hidden="true">${canceled ? '&#9728;' : '&#9749;'}</div>
  <p style="margin:0 0 14px;font-size:10px;letter-spacing:2.2px;font-weight:bold;color:${accent}">${label}</p>
  <h1 class="email-title" style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:38px;line-height:1.15;color:#39423a">${heading}</h1>
  <p style="margin:0;font-size:14px;line-height:1.8;color:#71806b">${intro}</p>
</td></tr>
<tr><td class="email-pad" style="padding:30px 32px 26px;background:#fffefb;border-left:1px solid #e0e5d9;border-right:1px solid #e0e5d9">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#f2f5ec;border:1px solid #e2e8db;border-radius:14px"><tr><td style="padding:20px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%"><tr>
      <td class="date-cell" width="66%" style="width:66%;vertical-align:middle;padding-right:14px">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td class="date-number" width="62" align="center" style="width:62px;background:#fffefb;border:1px solid #dce4d4;border-radius:11px;padding:9px 0;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:40px;color:${accent}">${escape(day)}</td>
          <td style="padding-left:14px;vertical-align:middle"><p style="margin:0 0 5px;font-size:14px;font-weight:bold;text-transform:capitalize;color:#44543c">${escape(weekday)}</p><p style="margin:0;font-size:11px;line-height:1.6;color:#71806b">${escape(month)}</p></td>
        </tr></table>
      </td>
      <td class="time-cell" width="34%" style="width:34%;vertical-align:middle;text-align:center;border-left:1px solid #dce4d4;padding-left:14px"><p style="margin:0 0 6px;font-size:17px;line-height:1.4;font-weight:bold;color:#44543c">${escape(time)}</p><p style="margin:0;font-size:10px;color:#71806b">${escape(timezoneLabel)}</p></td>
    </tr></table>
  </td></tr></table>
  <p style="margin:28px 0 8px;font-size:10px;letter-spacing:1.8px;font-weight:bold;color:${accent}">EL PLAN</p>
  <h2 style="margin:0 0 23px;font-family:Georgia,'Times New Roman',serif;font-size:27px;line-height:1.25;font-weight:normal;word-wrap:break-word;color:#39423a">${escape(record.plan)}</h2>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #e7e9e0;border-bottom:1px solid #e7e9e0"><tr><td style="padding:19px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed"><tr>${details.map(([title, value], index) => `<td class="email-detail${index ? ' detail-last' : ''}" width="50%" style="width:50%;vertical-align:top;padding:${index ? '0 0 0 15px' : '0 15px 0 0'}"><p style="margin:0 0 8px;font-size:9px;letter-spacing:1.4px;font-weight:bold;color:#8a9481">${title}</p><p style="margin:0;font-size:13px;line-height:1.7;word-wrap:break-word;white-space:pre-wrap;color:#4e574a">${escape(value)}</p></td>`).join('')}</tr></table>
  </td></tr></table>
  ${record.note ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin-top:20px;background:#f8f0eb;border-radius:11px"><tr><td style="padding:16px 18px;border-left:3px solid #c4998d;border-radius:0 11px 11px 0"><p style="margin:0 0 7px;font-size:9px;letter-spacing:1.5px;font-weight:bold;color:#a27d70">UN PEQUEÑO DETALLE</p><p style="margin:0;font-size:13px;line-height:1.7;white-space:pre-wrap;word-wrap:break-word;color:#736157">${escape(record.note)}</p></td></tr></table>` : ''}
</td></tr>
<tr><td align="center" style="padding:0 26px 27px;background:#fffefb;border:1px solid #e0e5d9;border-top:0;border-radius:0 0 22px 22px"><p style="margin:4px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:17px;font-style:italic;line-height:1.6;color:#9c7069">${closing}</p></td></tr>
<tr><td align="center" style="padding:22px 20px 4px"><p style="margin:0 0 7px;font-family:Georgia,'Times New Roman',serif;font-size:18px;color:${accent}">Un plan contigo</p><p style="margin:0;font-size:10px;line-height:1.7;color:#929789">${canceled ? 'Este correo confirma la cancelación de la salida.' : 'Guarda este correo para tener los detalles a mano.'}</p></td></tr>
</table></td></tr></table></body></html>`;
  return { subject: `${kind === 'Agendada' ? 'Salida agendada' : kind === 'Reprogramada' ? 'Salida reprogramada' : 'Salida cancelada'} · ${date}`, text, html };
}

function updateSummary(record, jobs) {
  const current = jobs.filter(job => job.appointmentId === record.id && job.eventId === record.emailEvent);
  if (!current.length) { record.emailStatus = 'Sin avisos'; return; }
  if (current.every(job => job.status === 'Aceptado')) record.emailStatus = 'Aceptado';
  else if (current.some(job => job.status === 'Revisar')) record.emailStatus = 'Revisar';
  else if (current.some(job => job.status === 'Error')) record.emailStatus = 'Error';
  else if (current.every(job => job.status === 'Sin configurar')) record.emailStatus = 'Sin configurar';
  else record.emailStatus = 'Pendiente';
}
function mailError(error) {
  if (error.code === 'EAUTH') return { status: 'Error', message: 'Gmail rechazó el acceso. Revisa la contraseña de aplicación y SMTP_USER.' };
  if (error.code === 'EENVELOPE') return { status: 'Error', message: 'El servidor rechazó el destinatario. Revisa su dirección.' };
  if (error.command === 'CONN' || error.code === 'EDNS' || error.code === 'ECONNECTION' || error.code === 'ESOCKET' && (!error.command || error.command === 'CONN')) return { status: 'Error', message: 'No se pudo conectar con el servidor de correo. Revisa la red y el servicio SMTP.' };
  // Después de DATA, un timeout puede haber ocurrido tras aceptar el mensaje.
  // No se reenvía automáticamente: SMTP no ofrece idempotencia garantizada.
  return { status: 'Revisar', message: 'No pudimos confirmar el resultado del envío. Revisa el buzón antes de volver a enviarlo.' };
}

export class EmailNotifications {
  constructor(store, mailer) { this.store = store; this.mailer = mailer; this.running = null; this.timer = null; this.stopped = false; }

  enqueue(record, jobs, kind) {
    const recipients = [...new Set([this.mailer.ownerEmail, record.guestEmail].filter(Boolean).map(email => email.toLowerCase()))];
    if (!recipients.length) return;
    for (const job of jobs) {
      if (job.appointmentId === record.id && ['Pendiente', 'Sin configurar', 'Error', 'Revisar'].includes(job.status)) job.status = 'Obsoleto';
    }
    record.emailEvent = randomUUID();
    const snapshot = JSON.stringify(Object.fromEntries(['date', 'time', 'plan', 'food', 'location', 'note', 'timezone'].map(key => [key, record[key]])));
    for (const recipient of recipients) jobs.push({ id: randomUUID(), appointmentId: record.id, eventId: record.emailEvent, kind, recipient, status: this.mailer.configured ? 'Pendiente' : 'Sin configurar', createdAt: new Date().toISOString(), attemptedAt: '', acceptedAt: '', messageId: '', error: '', snapshot });
    updateSummary(record, jobs);
  }

  async recover() {
    const state = await this.store.state();
    if (!state.notifications.some(job => job.status === 'Enviando')) return;
    await this.store.mutate((records, jobs) => {
      for (const job of jobs) if (job.status === 'Enviando') { job.status = 'Revisar'; job.error = 'El servicio reinició durante el envío. Revisa el buzón antes de volver a enviar.'; }
      for (const record of records) updateSummary(record, jobs);
    });
  }

  start() {
    if (!this.mailer.configured) return;
    this.stopped = false;
    this.kick();
    this.timer = setInterval(() => this.kick(), 30000);
    this.timer.unref();
  }

  kick() {
    if (this.stopped || !this.mailer.configured) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.drain().catch(() => { console.error('No se pudo actualizar el estado del correo. Revisa la agenda privada.'); }).finally(() => { this.running = null; });
    return this.running;
  }

  async drain() {
    while (!this.stopped && this.mailer.configured) {
      const state = await this.store.state();
      const next = state.notifications.find(job => pendingStates.includes(job.status));
      if (!next) return;
      const job = await this.store.mutate((records, jobs) => {
        const selected = jobs.find(item => item.id === next.id);
        const record = records.find(item => item.id === selected?.appointmentId);
        if (!selected || !pendingStates.includes(selected.status)) return null;
        if (!record || record.emailEvent !== selected.eventId) { selected.status = 'Obsoleto'; return null; }
        selected.status = 'Enviando'; selected.error = ''; selected.attemptedAt = new Date().toISOString();
        updateSummary(record, jobs);
        return { ...selected };
      });
      if (!job) continue;
      let outcome;
      try { const result = await this.mailer.send(job); outcome = { status: 'Aceptado', messageId: result.messageId || '', acceptedAt: new Date().toISOString(), error: '' }; }
      catch (error) { const detail = mailError(error); outcome = { status: detail.status, error: detail.message }; }
      await this.store.mutate((records, jobs) => {
        const selected = jobs.find(item => item.id === job.id);
        Object.assign(selected, outcome);
        const record = records.find(item => item.id === job.appointmentId);
        if (record) updateSummary(record, jobs);
      });
    }
  }

  async retry(appointmentId, confirmUncertain = false) {
    if (!this.mailer.configured) throw Object.assign(new Error('Primero activa el correo en la configuración privada.'), { status: 409 });
    await this.store.mutate((records, jobs) => {
      const record = records.find(item => item.id === appointmentId);
      if (!record) throw Object.assign(new Error('No encontramos esa salida.'), { status: 404 });
      const current = jobs.filter(job => job.appointmentId === appointmentId && job.eventId === record.emailEvent);
      if (current.some(job => job.status === 'Revisar') && !confirmUncertain) throw Object.assign(new Error('Revisa primero ambos buzones. El envío anterior podría haberse recibido.'), { status: 409 });
      for (const job of current) if (['Error', 'Revisar', 'Sin configurar'].includes(job.status)) { job.status = 'Pendiente'; job.error = ''; }
      updateSummary(record, jobs);
    });
    this.kick();
  }

  async stop() { this.stopped = true; clearInterval(this.timer); if (this.running) await this.running; this.mailer.close?.(); }
}
