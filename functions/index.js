const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("node:crypto");

initializeApp();
const db = getFirestore();
const REGION = "southamerica-east1";
const ADMIN_EMAIL = "dionesiaguarina98@gmail.com";
const TIME_ZONE = "America/Sao_Paulo";
const SLOT_MINUTES = 30;
const MAX_DAYS_AHEAD = 60;
const MIN_ADVANCE_HOURS = 2;
const ALLOWED_ORIGINS = [
  "https://aparthursilva21-creator.github.io",
  "http://localhost:5000",
  "http://127.0.0.1:5000"
];

const dayKeys = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

function requireAdmin(request) {
  const user = request.auth;
  if (!user || user.token.email !== ADMIN_EMAIL || user.token.email_verified !== true) {
    throw new HttpsError("permission-denied", "Acesso restrito à gestora autorizada.");
  }
}

function cleanText(value, max) {
  return String(value || "").trim().replace(/[<>]/g, "").slice(0, max);
}

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date + "T12:00:00-03:00"));
}

function localDateTime(date, time) {
  if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const value = new Date(date + "T" + time + ":00-03:00");
  return Number.isNaN(value.getTime()) ? null : value;
}

function scheduleFor(professional, date) {
  const weekday = new Date(date + "T12:00:00-03:00").getDay();
  const key = dayKeys[weekday];
  const schedule = professional.agenda && professional.agenda[key];
  if (!schedule || schedule.ativo === false || !schedule.inicio || !schedule.fim) return null;
  return schedule;
}

function fitsSchedule(schedule, start, end) {
  const startMinute = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
  const endMinute = Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5));
  const open = Number(schedule.inicio.slice(0, 2)) * 60 + Number(schedule.inicio.slice(3, 5));
  const close = Number(schedule.fim.slice(0, 2)) * 60 + Number(schedule.fim.slice(3, 5));
  if (startMinute < open || endMinute > close) return false;
  const breakStart = schedule.intervaloInicio;
  const breakEnd = schedule.intervaloFim;
  if (breakStart && breakEnd) {
    const bs = Number(breakStart.slice(0, 2)) * 60 + Number(breakStart.slice(3, 5));
    const be = Number(breakEnd.slice(0, 2)) * 60 + Number(breakEnd.slice(3, 5));
    if (startMinute < be && endMinute > bs) return false;
  }
  return true;
}

function serviceBelongsToProfessional(service, professional) {
  const assigned = normalize(service.profissional);
  return !assigned || assigned === "todas" || assigned === "qualquer profissional" || assigned === normalize(professional.nome);
}

function assertDateWindow(date, start) {
  const now = Date.now();
  if (start.getTime() < now + MIN_ADVANCE_HOURS * 60 * 60 * 1000) {
    throw new HttpsError("failed-precondition", "Escolha um horário com pelo menos 2 horas de antecedência.");
  }
  const max = now + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000;
  if (start.getTime() > max) {
    throw new HttpsError("failed-precondition", "Os agendamentos estão disponíveis para até 60 dias.");
  }
}

async function getActiveCatalog() {
  const [servicesSnap, professionalsSnap] = await Promise.all([
    db.collection("servicos").get(),
    db.collection("profissionais").get()
  ]);
  const services = servicesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(s => s.ativo !== false && Number(s.duracaoMinutos) >= 5 && Number(s.duracaoMinutos) <= 480)
    .map(s => ({
      id: s.id, nome: cleanText(s.nome, 100), categoria: cleanText(s.categoria, 80),
      preco: Number(s.preco || 0), duracaoMinutos: Number(s.duracaoMinutos),
      profissional: cleanText(s.profissional, 100)
    }));
  const professionals = professionalsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(p => p.ativo !== false)
    .map(p => ({ id: p.id, nome: cleanText(p.nome, 100), especialidade: cleanText(p.especialidade, 100) }));
  return { services, professionals };
}

async function listConflicts(professionalId, date) {
  const snap = await db.collection("agendamentos").where("data", "==", date).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(a => a.profissionalId === professionalId && a.status !== "cancelado");
}

function isConflict(startMs, endMs, appointments) {
  return appointments.some(a => {
    const aStart = Number(a.inicioMs || localDateTime(a.data, a.hora)?.getTime() || 0);
    const aEnd = Number(a.fimMs || (aStart + Number(a.duracaoMinutos || 0) * 60000));
    return startMs < aEnd && endMs > aStart;
  });
}

async function createBooking(data, source) {
  const serviceId = cleanText(data.serviceId, 150);
  const professionalId = cleanText(data.professionalId, 150);
  const date = cleanText(data.date, 10);
  const time = cleanText(data.time, 5);
  const customer = cleanText(data.customer, 100);
  const whatsapp = String(data.whatsapp || "").replace(/\D/g, "").slice(0, 15);

  if (!serviceId || !professionalId || !validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || customer.length < 2) {
    throw new HttpsError("invalid-argument", "Confira os dados do agendamento.");
  }
  if (source === "public" && whatsapp.length < 10) {
    throw new HttpsError("invalid-argument", "Informe um WhatsApp válido com DDD.");
  }

  const start = localDateTime(date, time);
  const startMs = start.getTime();
  const [serviceSnap, professionalSnap] = await Promise.all([
    db.collection("servicos").doc(serviceId).get(),
    db.collection("profissionais").doc(professionalId).get()
  ]);
  if (!serviceSnap.exists || !professionalSnap.exists) throw new HttpsError("not-found", "Serviço ou profissional não encontrado.");

  const service = { id: serviceSnap.id, ...serviceSnap.data() };
  const professional = { id: professionalSnap.id, ...professionalSnap.data() };
  if (service.ativo === false || professional.ativo === false) throw new HttpsError("failed-precondition", "Esse serviço ou profissional não está disponível.");
  if (!serviceBelongsToProfessional(service, professional)) throw new HttpsError("failed-precondition", "Essa profissional não realiza o serviço selecionado.");

  const duration = Number(service.duracaoMinutos);
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) throw new HttpsError("failed-precondition", "O serviço ainda não tem uma duração válida cadastrada.");
  assertDateWindow(date, start);

  const end = new Date(startMs + duration * 60000);
  const endClock = clockAfter(time, duration);
  const schedule = scheduleFor(professional, date);
  if (!schedule || !endClock || !fitsSchedule(schedule, time, endClock)) {
    throw new HttpsError("failed-precondition", "Esse horário está fora da agenda configurada para a profissional.");
  }
  if ((Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))) % SLOT_MINUTES !== 0) {
    throw new HttpsError("failed-precondition", "Escolha um horário disponível em intervalos de 30 minutos.");
  }

  const appointmentRef = db.collection("agendamentos").doc();
  const lockRef = db.collection("agenda_locks").doc(professionalId + "_" + date);
  const dateQuery = db.collection("agendamentos").where("data", "==", date);

  await db.runTransaction(async tx => {
    const [lockSnap, appointmentsSnap] = await Promise.all([tx.get(lockRef), tx.get(dateQuery)]);
    const existing = appointmentsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(a => a.profissionalId === professionalId && a.status !== "cancelado");
    if (isConflict(startMs, end.getTime(), existing)) {
      throw new HttpsError("already-exists", "Esse horário acabou de ser reservado. Escolha outro.");
    }
    tx.set(lockRef, { version: Number(lockSnap.data()?.version || 0) + 1, atualizadoEm: FieldValue.serverTimestamp() });
    tx.create(appointmentRef, {
      cliente: customer,
      whatsapp,
      servico: cleanText(service.nome, 100),
      servicoId: service.id,
      profissional: cleanText(professional.nome, 100),
      profissionalId: professional.id,
      data: date,
      hora: time,
      duracaoMinutos: duration,
      valor: Number(service.preco || 0),
      inicioMs: startMs,
      fimMs: end.getTime(),
      status: source === "admin" ? "confirmado" : "aguardando",
      origem: source === "admin" ? "painel" : "site",
      criadoEm: FieldValue.serverTimestamp(),
      atualizadoEm: FieldValue.serverTimestamp()
    });
  });

  return { ok: true, appointmentId: appointmentRef.id, status: source === "admin" ? "confirmado" : "aguardando" };
}

exports.publicCatalog = onCall({ region: REGION, cors: ALLOWED_ORIGINS }, async () => {
  return await getActiveCatalog();
});

exports.availableSlots = onCall({ region: REGION, cors: ALLOWED_ORIGINS }, async request => {
  const serviceId = cleanText(request.data?.serviceId, 150);
  const professionalId = cleanText(request.data?.professionalId, 150);
  const date = cleanText(request.data?.date, 10);
  if (!serviceId || !professionalId || !validDate(date)) throw new HttpsError("invalid-argument", "Dados de consulta inválidos.");

  const [serviceSnap, professionalSnap, conflicts] = await Promise.all([
    db.collection("servicos").doc(serviceId).get(),
    db.collection("profissionais").doc(professionalId).get(),
    listConflicts(professionalId, date)
  ]);
  if (!serviceSnap.exists || !professionalSnap.exists) return { slots: [] };
  const service = serviceSnap.data();
  const professional = professionalSnap.data();
  if (service.ativo === false || professional.ativo === false || !serviceBelongsToProfessional(service, professional)) return { slots: [] };

  const duration = Number(service.duracaoMinutos);
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) return { slots: [] };
  const dateStart = localDateTime(date, "00:00");
  if (!dateStart || dateStart.getTime() > Date.now() + MAX_DAYS_AHEAD * 86400000) return { slots: [] };
  const schedule = scheduleFor(professional, date);
  if (!schedule) return { slots: [] };

  const slots = [];
  const [openH, openM] = schedule.inicio.split(":").map(Number);
  const [closeH, closeM] = schedule.fim.split(":").map(Number);
  const open = openH * 60 + openM;
  const close = closeH * 60 + closeM;
  const now = Date.now();
  for (let minute = open; minute + duration <= close; minute += SLOT_MINUTES) {
    const time = String(Math.floor(minute / 60)).padStart(2, "0") + ":" + String(minute % 60).padStart(2, "0");
    const start = localDateTime(date, time);
    const end = new Date(start.getTime() + duration * 60000);
    const endClock = clockAfter(time, duration);
    if (start.getTime() < now + MIN_ADVANCE_HOURS * 3600000) continue;
    if (!endClock || !fitsSchedule(schedule, time, endClock)) continue;
    if (!isConflict(start.getTime(), end.getTime(), conflicts)) slots.push(time);
  }
  return { slots };
});

exports.createPublicBooking = onCall({ region: REGION, cors: ALLOWED_ORIGINS }, async request => {
  return await createBooking(request.data || {}, "public");
});

exports.createAdminBooking = onCall({ region: REGION, cors: ALLOWED_ORIGINS }, async request => {
  requireAdmin(request);
  return await createBooking(request.data || {}, "admin");
});

exports.updateBookingStatus = onCall({ region: REGION, cors: ALLOWED_ORIGINS }, async request => {
  requireAdmin(request);
  const id = cleanText(request.data?.appointmentId, 150);
  const status = cleanText(request.data?.status, 30);
  if (!id || !["aguardando", "confirmado", "concluido", "cancelado"].includes(status)) {
    throw new HttpsError("invalid-argument", "Status ou agendamento inválido.");
  }
  const ref = db.collection("agendamentos").doc(id);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Agendamento não encontrado.");
    tx.update(ref, { status, atualizadoEm: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});
