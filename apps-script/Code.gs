/**
 * DG Nails — backend gratuito com Google Apps Script + Google Sheets.
 * Execute setupDatabase() uma vez na conta Google que será dona dos dados.
 *
 * Abas criadas:
 *   Servicos: id | nome | categoria | preco | duracaoMinutos | profissional | ativo
 *   Profissionais: id | nome | especialidade | ativo | agendaJson
 *   Agendamentos: id | criadoEm | cliente | whatsapp | servicoId | servico |
 *                 profissionalId | profissional | data | hora | duracaoMinutos |
 *                 valor | status | origem
 *
 * Web App: implantar para executar como proprietário e permitir acesso conforme
 * a configuração descrita no README. Não coloque senhas/chaves no HTML público.
 */
const DG = {
  timezone: 'America/Sao_Paulo',
  maxDaysAhead: 60,
  minAdvanceMinutes: 120,
  slotMinutes: 30,
  sheets: {
    services: 'Servicos',
    professionals: 'Profissionais',
    bookings: 'Agendamentos'
  }
};

function setupDatabase() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('DG_SPREADSHEET_ID');
  let ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('DG Nails — Banco de Agendamentos');
    id = ss.getId();
    props.setProperty('DG_SPREADSHEET_ID', id);
  }

  ensureSheet_(ss, DG.sheets.services, [
    'id', 'nome', 'categoria', 'preco', 'duracaoMinutos', 'profissional', 'ativo'
  ]);
  ensureSheet_(ss, DG.sheets.professionals, [
    'id', 'nome', 'especialidade', 'ativo', 'agendaJson'
  ]);
  ensureSheet_(ss, DG.sheets.bookings, [
    'id', 'criadoEm', 'cliente', 'whatsapp', 'servicoId', 'servico',
    'profissionalId', 'profissional', 'data', 'hora', 'duracaoMinutos',
    'valor', 'status', 'origem'
  ]);
  Logger.log('Banco DG Nails criado: ' + ss.getUrl());
  return ss.getUrl();
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  sh.setFrozenRows(1);
  return sh;
}

function database_() {
  const id = PropertiesService.getScriptProperties().getProperty('DG_SPREADSHEET_ID');
  if (!id) throw new Error('Execute setupDatabase() antes de publicar o Web App.');
  return SpreadsheetApp.openById(id);
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function rows_(sheetName) {
  const sh = database_().getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues();
  const headers = values.shift().map(String);
  return values.filter(row => row.some(v => v !== '')).map(row => {
    const item = {};
    headers.forEach((h, i) => item[h] = row[i]);
    return item;
  });
}

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'catalog');
    if (action === 'catalog') return json_(catalog_());
    if (action === 'slots') {
      return json_(slots_(String(e.parameter.serviceId || ''),
        String(e.parameter.professionalId || ''), String(e.parameter.date || '')));
    }
    if (action === 'health') return json_({ ok: true, service: 'DG Nails API' });
    return json_({ ok: false, error: 'Ação não reconhecida.' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'Não foi possível consultar os dados.' });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const raw = e && e.postData && e.postData.contents;
    const data = raw ? JSON.parse(raw) : (e && e.parameter) || {};
    if (data.action !== 'booking') return json_({ ok: false, error: 'Ação não reconhecida.' });

    lock.waitLock(20000);
    const result = createBooking_(data);
    return json_(result);
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: err && err.publicMessage ? err.publicMessage : 'Não foi possível concluir. Atualize a página e tente novamente.' });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function catalog_() {
  const services = rows_(DG.sheets.services)
    .filter(s => truthy_(s.ativo) && Number(s.duracaoMinutos) >= 5)
    .map(s => ({
      id: String(s.id), nome: String(s.nome), categoria: String(s.categoria || ''),
      preco: Number(s.preco || 0), duracaoMinutos: Number(s.duracaoMinutos),
      profissional: String(s.profissional || '')
    }));
  const professionals = rows_(DG.sheets.professionals)
    .filter(p => truthy_(p.ativo))
    .map(p => ({ id: String(p.id), nome: String(p.nome), especialidade: String(p.especialidade || '') }));
  return { ok: true, services, professionals };
}

function slots_(serviceId, professionalId, date) {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) return { ok: false, slots: [] };
  const cat = catalog_();
  const service = cat.services.find(s => s.id === serviceId);
  const professional = cat.professionals.find(p => p.id === professionalId);
  if (!service || !professional || !serviceFitsProfessional_(service, professional)) return { ok: true, slots: [] };

  const day = new Date(date + 'T12:00:00-03:00');
  if (isNaN(day.getTime()) || day.getTime() < startOfToday_() ||
      day.getTime() > Date.now() + DG.maxDaysAhead * 86400000) return { ok: true, slots: [] };

  const profRow = rows_(DG.sheets.professionals).find(p => String(p.id) === professionalId);
  const schedule = scheduleFor_(profRow, day.getDay());
  if (!schedule) return { ok: true, slots: [] };

  const open = minutes_(schedule.inicio);
  const close = minutes_(schedule.fim);
  const duration = service.duracaoMinutos;
  const booked = rows_(DG.sheets.bookings).filter(b =>
    String(b.profissionalId) === professionalId && String(b.data) === date &&
    String(b.status).toLowerCase() !== 'cancelado'
  );
  const result = [];
  for (let m = open; m + duration <= close; m += DG.slotMinutes) {
    const time = clock_(m);
    const start = new Date(date + 'T' + time + ':00-03:00').getTime();
    const end = start + duration * 60000;
    if (start < Date.now() + DG.minAdvanceMinutes * 60000) continue;
    if (!fitsBreak_(schedule, m, m + duration)) continue;
    const conflict = booked.some(b => {
      const bs = new Date(String(b.data) + 'T' + String(b.hora) + ':00-03:00').getTime();
      return start < bs + Number(b.duracaoMinutos) * 60000 && end > bs;
    });
    if (!conflict) result.push(time);
  }
  return { ok: true, slots: result };
}

function createBooking_(data) {
  const serviceId = clean_(data.serviceId, 100);
  const professionalId = clean_(data.professionalId, 100);
  const date = String(data.date || '');
  const time = String(data.time || '');
  const customer = clean_(data.customer, 80);
  const whatsapp = String(data.whatsapp || '').replace(/\\D/g, '').slice(0, 15);
  if (!serviceId || !professionalId || !/^\\d{4}-\\d{2}-\\d{2}$/.test(date) ||
      !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(time) || customer.length < 2 || whatsapp.length < 10) {
    throw publicError_('Confira nome, WhatsApp, serviço, profissional e horário.');
  }

  const cat = catalog_();
  const service = cat.services.find(s => s.id === serviceId);
  const professional = cat.professionals.find(p => p.id === professionalId);
  if (!service || !professional || !serviceFitsProfessional_(service, professional)) {
    throw publicError_('O serviço ou profissional não está disponível.');
  }
  const available = slots_(serviceId, professionalId, date).slots;
  if (!available.includes(time)) throw publicError_('Esse horário não está mais disponível. Escolha outro.');

  const sh = database_().getSheetByName(DG.sheets.bookings);
  const id = Utilities.getUuid();
  sh.appendRow([
    id, new Date(), customer, whatsapp, service.id, service.nome,
    professional.id, professional.nome, date, time, service.duracaoMinutos,
    service.preco, 'aguardando', 'site'
  ]);

  notifySalon_(customer, whatsapp, service, professional, date, time);
  return { ok: true, appointmentId: id, status: 'aguardando' };
}

function notifySalon_(customer, whatsapp, service, professional, date, time) {
  const email = PropertiesService.getScriptProperties().getProperty('DG_NOTIFICATION_EMAIL');
  if (!email) return;
  const when = Utilities.formatDate(new Date(date + 'T' + time + ':00-03:00'), DG.timezone, "dd/MM/yyyy 'às' HH:mm");
  const subject = 'Novo pedido de agendamento — DG Nails';
  const body = 'Novo pedido recebido pelo site.\\n\\nCliente: ' + customer +
    '\\nWhatsApp: ' + whatsapp + '\\nServiço: ' + service.nome +
    '\\nProfissional: ' + professional.nome + '\\nData: ' + when +
    '\\n\\nAcesse o painel DG Nails para confirmar.';
  try { MailApp.sendEmail(email, subject, body); } catch (err) { console.error(err); }
}

function scheduleFor_(professional, weekday) {
  if (!professional || !professional.agendaJson) return null;
  let agenda;
  try { agenda = typeof professional.agendaJson === 'string' ? JSON.parse(professional.agendaJson) : professional.agendaJson; }
  catch (err) { return null; }
  const keys = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  const s = agenda[keys[weekday]];
  return s && s.ativo !== false && s.inicio && s.fim ? s : null;
}

function serviceFitsProfessional_(service, professional) {
  const assigned = normalize_(service.profissional);
  return !assigned || assigned === 'todas' || assigned === 'qualquer profissional' || assigned === normalize_(professional.nome);
}

function fitsBreak_(s, start, end) {
  if (s.intervaloInicio && s.intervaloFim) {
    const a = minutes_(s.intervaloInicio), b = minutes_(s.intervaloFim);
    if (start < b && end > a) return false;
  }
  return true;
}

function truthy_(v) { return v === true || String(v).toLowerCase() === 'true' || String(v) === '1' || String(v).toLowerCase() === 'sim'; }
function clean_(v, max) { return String(v || '').trim().replace(/[<>]/g, '').slice(0, max); }
function normalize_(v) { return String(v || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().trim(); }
function minutes_(v) { const p = String(v).split(':').map(Number); return p[0] * 60 + p[1]; }
function clock_(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
function startOfToday_() { const s = Utilities.formatDate(new Date(), DG.timezone, 'yyyy-MM-dd'); return new Date(s + 'T00:00:00-03:00').getTime(); }
function publicError_(message) { const e = new Error(message); e.publicMessage = message; return e; }
