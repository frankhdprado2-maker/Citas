const app = document.querySelector('#app');
const dialog = document.querySelector('#cancel-dialog');
const storageKey = 'un-plan-contigo-confirmacion';
let config, step = 0, editing = false, busy = false, booking = null, credential = null;
let draft = { date: '', time: '18:00', plan: 'cafe', food: 'elegimos', location: '', note: '', guestEmail: '' };
let emailTimer = null;
let submission = null;
let firstRender = true;
const welcomeIntro = document.querySelector('.welcome-intro');
if (matchMedia('(prefers-reduced-motion: reduce)').matches) welcomeIntro?.remove();
else if (welcomeIntro) {
  welcomeIntro.addEventListener('animationend', event => {
    if (event.target === welcomeIntro) welcomeIntro.remove();
  });
  setTimeout(() => welcomeIntro.remove(), 2200);
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="/icons.svg#${name}"></use></svg>`;
const button = (label, action, type = '') => `<button class="btn ${type}" data-action="${action}">${label}</button>`;
const dateLabel = date => new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const timeLabel = time => new Intl.DateTimeFormat('es-PE', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(new Date(`2026-01-01T${time}:00Z`));
function stash(key, value, local = false) { try { (local ? localStorage : sessionStorage).setItem(key, JSON.stringify(value)); } catch {} }
function retrieve(key, local = false) { try { return JSON.parse((local ? localStorage : sessionStorage).getItem(key)); } catch { return null; } }
function forget(key, local = false) { try { (local ? localStorage : sessionStorage).removeItem(key); } catch {} }
function toast(message) { const element = document.querySelector('#toast'); element.textContent = message; element.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { element.hidden = true; }, 4000); }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No pudimos conectar. Intenta nuevamente.');
  return data;
}
function errorMessage(message) { const element = app.querySelector('#form-error'); if (element) { element.textContent = message; element.hidden = false; element.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } else toast(message); }
const errorRegion = '<p id="form-error" class="error" role="alert" hidden></p>';
function steps(active) { return `<ol class="steps" aria-label="Progreso">${['El día y el plan', 'Los detalles', 'Confirmación'].map((label, index) => `<li class="${index + 1 === active ? 'active' : index + 1 < active ? 'complete' : ''}" ${index + 1 === active ? 'aria-current="step"' : ''}><span class="step-number">${index + 1 < active ? icon('check') : index + 1}</span>${label}</li>`).join('')}</ol>`; }
function heading(label, title, subtitle) { return `<div class="step-heading"><span class="eyebrow">${label}</span><h1 tabindex="-1">${title}</h1><p>${subtitle}</p></div>`; }
function summary(record) {
  return `<div class="summary"><div class="summary-row">${icon('calendar')}<div><small>El día</small><strong>${escape(dateLabel(record.date))}</strong></div></div><div class="summary-row">${icon('clock')}<div><small>La hora</small><strong>${escape(timeLabel(record.time))}</strong></div><span class="sub">${escape(record.timezone || config.timezone)}</span></div><div class="summary-row">${icon('sparkles')}<div><small>El plan</small><strong>${escape(record.plan)}</strong></div></div><div class="summary-row">${icon('utensils')}<div><small>Algo rico</small><strong>${escape(record.food)}</strong></div></div><div class="summary-row">${icon('pin')}<div><small>El lugar</small><strong>${escape(record.location || 'Lo coordinamos después')}</strong></div></div></div>${record.note ? `<p class="summary-note">${escape(record.note)}</p>` : ''}`;
}
function draftSummary() { return { ...draft, plan: config.plans.find(item => item.id === draft.plan).label, food: config.foods.find(item => item.id === draft.food).label }; }
function emailField() {
  return `<label class="field"><span class="field-label">Tu correo <span>· obligatorio</span></span><input name="guestEmail" type="email" required autocomplete="email" inputmode="email" maxlength="254" placeholder="nombre@gmail.com" value="${escape(draft.guestEmail)}"><span class="hint">Aquí recibirás los detalles de la salida y cualquier cambio del plan.</span></label>`;
}
function emailReview() {
  return draft.guestEmail ? `<p class="email-review">${icon('mail')}La confirmación también irá a <strong>${escape(draft.guestEmail)}</strong>.</p>` : '<p class="email-review">Añade tu correo en los detalles para recibir la confirmación.</p>';
}
function emailNotice() {
  if (!booking.emailStatus || booking.emailStatus === 'Sin avisos') return '';
  const message = booking.emailStatus === 'Aceptado' ? 'El resumen se envió por correo. Revisa también spam.' : booking.emailStatus === 'Pendiente' ? 'Plan guardado. Estamos enviando el resumen por correo…' : booking.emailStatus === 'Sin configurar' ? 'Plan guardado. El aviso por correo queda pendiente de activación.' : 'Plan guardado. El aviso por correo quedó pendiente; puedes compartir el resumen mientras tanto.';
  return `<div class="email-notice" role="status">${icon('mail')}<p>${message}${booking.guestEmail ? `<small>Tu copia: ${escape(booking.guestEmail)}</small>` : ''}</p></div>`;
}
function pollEmail() {
  if (!booking || booking.emailStatus !== 'Pendiente') return;
  let checks = 0;
  const id = booking.id;
  emailTimer = setInterval(async () => {
    if (step !== 4 || ++checks > 15) { clearInterval(emailTimer); return; }
    try {
      const data = await api(`/api/appointments/${id}`, { headers: { 'X-Booking-Token': credential.token } });
      if (step !== 4 || booking.id !== id) return;
      const previousStatus = booking.status;
      booking = data.appointment;
      if (booking.status !== previousStatus) { render(false); return; }
      const region = app.querySelector('#email-notice'); if (region) region.innerHTML = emailNotice();
      if (booking.emailStatus !== 'Pendiente') clearInterval(emailTimer);
    } catch { if (checks >= 15) clearInterval(emailTimer); }
  }, 2000);
}
function render(focus = true) {
  clearInterval(emailTimer);
  app.setAttribute('aria-busy', 'false');
  if (step === 0) {
    app.innerHTML = `<section class="paper invitation"><span class="tiny-label">${icon('sparkles')}UNA INVITACIÓN PARA TI</span><img class="envelope" src="/envelope.svg" alt="Una taza de café con un pequeño corazón y un calendario"><h1 tabindex="-1">¿Salimos<br><em>un día de estos?</em></h1><p class="intro-copy">Me gustaría pasar un rato contigo.<br>Un café, una charla y la oportunidad<br>de conocernos un poquito más.</p>${button(`Sí, me gustaría ${icon('arrow')}`, 'accept', 'wide')}<button class="text-button" data-action="later">Tal vez otro día</button>${booking?.status === 'Confirmada' ? `<button class="text-button" data-action="show-booking">${icon('calendar')}Ver el plan guardado</button>` : ''}<div class="mini-divider"></div><p class="footnote">El plan lo elegimos juntos.</p></section>`;
  } else if (step === 1) {
    app.innerHTML = `<section class="paper step-card">${steps(1)}${heading(editing ? 'BUSQUEMOS OTRO MOMENTO' : 'HAGAMOS QUE PASE', '¿Cuándo te viene bien?', 'Elige un día, una hora y algo que te dé ganas.')}<form id="plan-form"><div class="form-row"><label class="field"><span class="field-label">El día</span><input name="date" type="date" required min="${config.now.date}" value="${escape(draft.date)}"></label><label class="field"><span class="field-label">La hora</span><input name="time" type="time" required value="${escape(draft.time)}"></label></div><p class="timezone">${icon('clock')}Hora de ${escape(config.timezone)} · sin apuro</p><fieldset><legend>¿Qué te gustaría hacer?</legend><div class="plan-grid">${config.plans.map(plan => `<label class="choice"><input type="radio" name="plan" value="${plan.id}" ${draft.plan === plan.id ? 'checked' : ''} required><span class="choice-surface"><span class="choice-icon">${icon(plan.icon)}</span><span class="choice-text"><strong>${escape(plan.label)}</strong><small>${escape(plan.detail)}</small></span><svg class="choice-check" aria-hidden="true"><use href="/icons.svg#check"></use></svg></span></label>`).join('')}</div></fieldset>${errorRegion}<div class="form-actions"><button type="button" class="text-button" data-action="back">${icon('back')}Volver</button><button class="btn" type="submit">Los detalles ${icon('arrow')}</button></div></form></section>`;
  } else if (step === 2) {
    app.innerHTML = `<section class="paper step-card">${steps(2)}${heading('EL TOQUE FINAL', '¿Se te antoja algo?', 'Podemos elegirlo ahora o decidir juntos ese día.')}<form id="details-form"><fieldset><legend class="sr-only">Elige una opción de comida</legend><div class="food-grid">${config.foods.map(food => `<label class="choice"><input type="radio" name="food" value="${food.id}" ${draft.food === food.id ? 'checked' : ''} required><span class="choice-surface"><span class="food-emoji" aria-hidden="true">${food.emoji}</span><span class="food-name">${escape(food.label)}</span></span></label>`).join('')}</div></fieldset><div class="optional-fields"><label class="field"><span class="field-label">¿Algún lugar en mente? <span>· opcional</span></span><input name="location" maxlength="160" placeholder="Un café, el parque, un restaurante…" value="${escape(draft.location)}"></label><label class="field"><span class="field-label">Algo que quieras contarme <span>· opcional</span></span><textarea name="note" maxlength="600" placeholder="Una preferencia, algo que no comes o una idea para el plan…">${escape(draft.note)}</textarea></label></div>${errorRegion}<div class="form-actions"><button type="button" class="text-button" data-action="back">${icon('back')}Volver</button><button class="btn" type="submit">Revisar el plan ${icon('arrow')}</button></div></form></section>`;
  } else if (step === 3) {
    app.innerHTML = `<section class="paper step-card">${steps(3)}${heading('TODO LISTO', '¿Así quedamos?', 'Revisa los detalles antes de confirmar.')}${summary(draftSummary())}${errorRegion}<div class="form-actions"><button class="text-button" data-action="back">${icon('back')}Cambiar detalles</button>${button(`${editing ? 'Guardar cambios' : '¡Quedamos!'} ${icon('check')}`, 'save')}</div><p class="privacy-note">Puedes reprogramarlo si después surge algo.</p></section>`;
  } else if (step === 4 && booking) {
    const canceled = booking.status === 'Cancelada';
    const completed = booking.status === 'Realizada';
    app.innerHTML = `<section class="paper success-card"><div class="success-bloom">${icon(canceled ? 'calendar' : 'check')}</div><span class="eyebrow">${canceled ? 'OTRA VEZ SERÁ' : completed ? 'PLAN REALIZADO' : 'YA TENEMOS UN PLAN'}</span><h1 tabindex="-1">${canceled ? 'Lo dejamos para después.' : completed ? '¡Plan realizado!' : '¡Nos vemos pronto!'}</h1><p>${canceled ? 'No hay problema. Podemos buscar otro momento cuando te venga bien.' : completed ? 'Este plan ya figura como realizado en la agenda.' : 'Qué gusto tener un plan contigo. Ya quedó todo guardado para nuestra salida.'}</p>${summary(booking)}${errorRegion}${button(`${icon('back')}Volver al inicio`, 'home', 'wide secondary success-home')}${canceled || completed ? button(`Organizar otro plan ${icon('arrow')}`, 'new', 'wide') : `<div class="button-row">${button(`${icon('calendar')}Añadir al calendario`, 'calendar', 'secondary')}${button(`${icon('share')}Compartir el plan`, 'share', 'secondary')}</div><div class="success-links"><button class="text-button" data-action="edit">${icon('edit')}Cambiar el plan</button><button class="text-button" data-action="cancel">Cancelar salida</button></div>`}<div class="mini-divider"></div><p class="footnote">${canceled || completed ? 'Cuando quieras, podemos organizar otro plan.' : 'Tu confirmación queda disponible en este dispositivo.'}</p></section>`;
  } else if (step === 5) {
    app.innerHTML = `<section class="paper invitation later-card"><span class="eyebrow">A TU RITMO</span><img class="envelope" src="/envelope.svg" alt="Una taza de café con un pequeño corazón y un calendario"><h1 tabindex="-1">Lo vemos<br><em>otro día.</em></h1><p class="intro-copy">Sin presión. La invitación sigue aquí<br>para cuando te apetezca.</p>${button('Volver a la invitación', 'home', 'secondary wide')}<div class="mini-divider"></div><p class="footnote">Elige el momento que te venga bien.</p></section>`;
  }
  if (focus) app.querySelector('h1')?.focus({ preventScroll: true });
  if (firstRender) { app.querySelector('.paper')?.classList.add('first-reveal'); firstRender = false; }
  if (focus) window.scrollTo({ top: 0, behavior: 'instant' });
  const form = app.querySelector('form');
  form?.addEventListener('submit', event => {
    event.preventDefault();
    capture();
    if (step === 1 && `${draft.date} ${draft.time}` <= `${config.now.date} ${config.now.time}`) return errorMessage('Elige una fecha y hora que todavía no hayan pasado.');
    step += 1; render();
  });
  if (step === 2) app.querySelector('.optional-fields')?.insertAdjacentHTML('beforeend', emailField());
  if (step === 3) app.querySelector('.summary')?.insertAdjacentHTML('afterend', emailReview());
  if (step === 4) {
    app.querySelector('.summary')?.insertAdjacentHTML('afterend', `<div id="email-notice">${emailNotice()}</div>`);
    pollEmail();
  }
}
function capture() {
  const form = app.querySelector('form');
  if (form) { for (const [name, value] of new FormData(form)) draft[name] = value; stash('un-plan-contigo-borrador', draft); }
}
function newSubmission() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  submission = { requestId: crypto.randomUUID(), token: [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('') };
  stash('un-plan-contigo-envio', submission);
}
function celebrate() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.createElement('div'); layer.className = 'confetti'; layer.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < 42; index++) { const piece = document.createElement('i'); piece.style.left = `${Math.random() * 100}%`; piece.style.animationDelay = `${Math.random() * .8}s`; piece.style.animationDuration = `${2 + Math.random() * 1.2}s`; layer.append(piece); }
  document.body.append(layer); setTimeout(() => layer.remove(), 4200);
}
async function save() {
  if (busy) return;
  busy = true;
  const buttons = app.querySelectorAll('button'); buttons.forEach(element => { element.disabled = true; });
  const saveButton = app.querySelector('[data-action="save"]'); saveButton.textContent = 'Guardando el plan…';
  try {
    if (!editing && !submission) newSubmission();
    const path = editing ? `/api/appointments/${booking.id}` : '/api/appointments';
    const data = await api(path, { method: editing ? 'PATCH' : 'POST', headers: editing ? { 'X-Booking-Token': credential.token } : {}, body: JSON.stringify({ ...draft, ...(!editing ? submission : {}) }) });
    booking = data.appointment;
    if (!editing) credential = { id: booking.id, token: submission.token };
    stash(storageKey, credential, true);
    forget('un-plan-contigo-borrador'); forget('un-plan-contigo-envio'); submission = null;
    editing = false; step = 4; render(); celebrate();
  } catch (error) {
    errorMessage(error.message === 'Failed to fetch' ? 'No hay conexión. Tu plan sigue aquí: vuelve a intentar cuando tengas internet.' : error.message);
    buttons.forEach(element => { element.disabled = false; }); saveButton.innerHTML = `${editing ? 'Guardar cambios' : '¡Quedamos!'} ${icon('check')}`;
  } finally { busy = false; }
}
async function downloadCalendar() {
  const response = await fetch(`/api/appointments/${booking.id}/calendar`, { headers: { 'X-Booking-Token': credential.token } });
  if (!response.ok) { const data = await response.json(); throw new Error(data.error); }
  const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = 'nuestro-plan.ics'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function share() {
  const text = `¡Tenemos un plan! 📅\n${dateLabel(booking.date)}, ${timeLabel(booking.time)} (${booking.timezone}).\n${booking.plan}.\nComida: ${booking.food}.\nLugar: ${booking.location || 'Lo coordinamos después'}.`;
  if (navigator.share) { try { await navigator.share({ title: 'Un plan contigo', text }); } catch (error) { if (error.name !== 'AbortError') throw error; } }
  else { await navigator.clipboard.writeText(text); toast('Plan copiado. Ya puedes pegarlo en WhatsApp.'); }
}
app.addEventListener('click', async event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action || busy) return;
  try {
    if (action === 'accept') { editing = false; step = 1; if (!submission) newSubmission(); render(); }
    else if (action === 'later') { step = 5; render(); }
    else if (action === 'home') { step = 0; render(); }
    else if (action === 'back') { capture(); if (step === 1 && editing) step = 4; else step -= 1; render(); }
    else if (action === 'save') await save();
    else if (action === 'show-booking') { step = 4; render(); }
    else if (action === 'calendar') await downloadCalendar();
    else if (action === 'share') await share();
    else if (action === 'cancel') { document.querySelector('#cancel-error').hidden = true; dialog.showModal(); }
    else if (action === 'edit') { draft = { date: booking.date, time: booking.time, plan: config.plans.find(item => item.label === booking.plan)?.id || 'cafe', food: config.foods.find(item => item.label === booking.food)?.id || 'elegimos', location: booking.location, note: booking.note, guestEmail: booking.guestEmail || '' }; editing = true; step = 1; render(); }
    else if (action === 'new') { editing = false; draft = { date: tomorrow(), time: '18:00', plan: 'cafe', food: 'elegimos', location: '', note: '', guestEmail: booking?.guestEmail || '' }; newSubmission(); step = 1; render(); }
  } catch (error) { errorMessage(error.message === 'Failed to fetch' ? 'No pudimos conectar. Intenta nuevamente.' : error.message); }
});
document.querySelector('#keep-plan').addEventListener('click', () => dialog.close());
document.querySelector('#confirm-cancel').addEventListener('click', async event => {
  event.target.disabled = true;
  try {
    const data = await api(`/api/appointments/${booking.id}/cancel`, { method: 'POST', headers: { 'X-Booking-Token': credential.token } });
    booking = data.appointment; dialog.close(); step = 4; render();
  } catch (error) { const element = document.querySelector('#cancel-error'); element.textContent = error.message; element.hidden = false; }
  finally { event.target.disabled = false; }
});
function tomorrow() { const date = new Date(`${config.now.date}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); }
async function init() {
  try {
    config = await api('/api/config');
    draft.date = tomorrow();
    const savedDraft = retrieve('un-plan-contigo-borrador'); if (savedDraft && savedDraft.date >= config.now.date) draft = { ...draft, ...savedDraft };
    submission = retrieve('un-plan-contigo-envio');
    credential = retrieve(storageKey, true);
    if (credential?.id && credential?.token) {
      try { const data = await api(`/api/appointments/${encodeURIComponent(credential.id)}`, { headers: { 'X-Booking-Token': credential.token } }); booking = data.appointment; step = 4; }
      catch (error) { if (!/No encontramos/.test(error.message)) throw error; forget(storageKey, true); credential = null; }
    }
    render(false);
  } catch {
    app.setAttribute('aria-busy', 'false');
    app.innerHTML = `<section class="paper invitation"><img class="envelope" src="/envelope.svg" alt="Una carta para ti"><h1>Un momentito…</h1><p class="intro-copy">No pudimos conectar con la agenda. Prueba de nuevo en unos segundos.</p><button class="btn wide" id="retry-init">Volver a intentar ${icon('arrow')}</button></section>`;
    document.querySelector('#retry-init').addEventListener('click', init);
  }
}
init();
