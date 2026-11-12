/**
 * DG Nails — backend gratuito com Google Apps Script + Google Sheets.
 *
 * EXECUÇÃO INICIAL:
 * 1. Entre no Apps Script com a conta administradora.
 * 2. Execute configurarSistema() uma única vez e autorize as permissões.
 * 3. Implante como Aplicativo da Web: executar como você; acesso qualquer pessoa.
 * 4. Configure a URL /exec no arquivo gas-client.js do site.
 *
 * O acesso administrativo é validado por Firebase Authentication (e-mail exato).
 * O banco operacional é uma planilha privada criada nesta conta.
 */

const CONFIG = {
  ADMIN_EMAIL: "dionesiaguarina98@gmail.com",
  FIREBASE_API_KEY: "AIzaSyDZiMsjK-3aUMSybjZr6UAS3b8bVXKQ3Nw",
  TIME_ZONE: "America/Sao_Paulo",
  MAX_DAYS_AHEAD: 60,
  MIN_ADVANCE_HOURS: 2,
  SLOT_MINUTES: 30,
  ADMIN_NOTIFICATION_EMAIL: "dionesiaguarina98@gmail.com",
  SHEET_PROPERTY: "DG_NAILS_SPREADSHEET_ID"
};

const TABLES = {
  servicos: ["id","nome","categoria","preco","duracaoMinutos","profissional","descricao","ativo","criadoEm","atualizadoEm"],
  profissionais: ["id","nome","especialidade","ativo","agendaJson","criadoEm","atualizadoEm"],
  agendamentos: ["id","cliente","whatsapp","servico","servicoId","profissional","profissionalId","data","hora","duracaoMinutos","valor","inicioMs","fimMs","status","origem","criadoEm","atualizadoEm","calendarEventId"]
};

function configurarSistema() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(CONFIG.SHEET_PROPERTY);
  let ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create("DG Nails — Sistema de Agendamentos");
    id = ss.getId();
    props.setProperty(CONFIG.SHEET_PROPERTY, id);
  }
  Object.keys(TABLES).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, TABLES[name].length).setValues([TABLES[name]]);
      sh.setFrozenRows(1);
    }
  });
  const defaultSheet = ss.getSheetByName("Planilha1");
  if (defaultSheet && ss.getSheets().length > 3 && defaultSheet.getLastRow() === 0) ss.deleteSheet(defaultSheet);
  Logger.log("Planilha DG Nails: " + ss.getUrl());
  return ss.getUrl();
}

function db_() {
  const id = PropertiesService.getScriptProperties().getProperty(CONFIG.SHEET_PROPERTY);
  if (!id) throw new Error("Execute configurarSistema() antes de usar o sistema.");
  return SpreadsheetApp.openById(id);
}

function output_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * GET é usado somente para consultar o resultado de uma requisição POST.
 * A resposta JSONP evita a limitação de CORS do Apps Script; o identificador
 * aleatório da requisição impede que terceiros adivinhem o resultado.
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action !== "result" || !/^[a-f0-9]{32}$/.test(p.requestId || "") ||
      !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p.callback || "")) {
    return output_({ ok: false, error: "Requisição inválida." });
  }
  const cached = CacheService.getScriptCache().get("req_" + p.requestId);
  const result = cached ? JSON.parse(cached) : { pending: true };
  return ContentService.createTextOutput(p.callback + "(" + JSON.stringify(result) + ");")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function doPost(e) {
  let requestId = "";
  try {
    const raw = e && e.parameter && e.parameter.payload
      ? e.parameter.payload
      : (e && e.postData && e.postData.contents) || "{}";
    const req = JSON.parse(raw);
    requestId = String(req.requestId || "");
    if (!/^[a-f0-9]{32}$/.test(requestId)) throw new Error("Identificador de requisição inválido.");
    const result = route_(req);
    CacheService.getScriptCache().put("req_" + requestId, JSON.stringify(result), 300);
  } catch (err) {
    if (requestId && /^[a-f0-9]{32}$/.test(requestId)) {
      CacheService.getScriptCache().put("req_" + requestId, JSON.stringify({ ok:false, error: safeMessage_(err) }), 300);
    }
  }
  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}

function route_(req) {
  const action = String(req.action || "");
  const data = req.data || {};
  const adminActions = [
    "adminData","saveService","setServiceActive","saveProfessional",
    "setProfessionalActive","saveSchedule","createAdminBooking","updateBookingStatus"
  ];
  if (adminActions.indexOf(action) >= 0) requireAdmin_(data.idToken);

  switch (action) {
    case "publicCatalog": return publicCatalog_();
    case "availableSlots": return availableSlots_(data);
    case "createPublicBooking": return createBooking_(data, "site");
    case "adminData": return adminData_();
    case "saveService": return saveService_(data);
    case "setServiceActive": return setActive_("servicos", data);
    case "saveProfessional": return saveProfessional_(data);
    case "setProfessionalActive": return setActive_("profissionais", data);
    case "saveSchedule": return saveSchedule_(data);
    case "createAdminBooking": return createBooking_(data, "painel");
    case "updateBookingStatus": return updateBookingStatus_(data);
    default: throw new Error("Ação não reconhecida.");
  }
}

function requireAdmin_(idToken) {
  if (!idToken || String(idToken).length < 100) throw new Error("Faça login como administradora.");
  const url = "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + CONFIG.FIREBASE_API_KEY;
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ idToken: idToken }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error("Sessão administrativa inválida. Entre novamente.");
  const body = JSON.parse(response.getContentText());
  const user = body.users && body.users[0];
  if (!user || String(user.email || "").toLowerCase() !== CONFIG.ADMIN_EMAIL ||
      user.emailVerified !== true || user.disabled === true) {
    throw new Error("Acesso restrito à conta administradora autorizada.");
  }
}

function sheet_(name) {
  const sh = db_().getSheetByName(name);
  if (!sh) throw new Error("Aba não encontrada: " + name);
  return sh;
}

function rows_(name) {
  const sh = sheet_(name);
  if (sh.getLastRow() < 2) return [];
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, TABLES[name].length).getValues();
  return values.map(row => {
    const obj = {};
    TABLES[name].forEach((key, i) => obj[key] = row[i]);
    return obj;
  }).filter(o => o.id);
}

function writeRow_(name, obj, id) {
  const sh = sheet_(name);
  const headers = TABLES[name];
  const all = rows_(name);
  const index = all.findIndex(r => String(r.id) === String(id));
  const row = headers.map(key => {
    const value = obj[key];
    return value === undefined ? "" : value;
  });
  if (index >= 0) sh.getRange(index + 2, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}

function publicCatalog_() {
  return {
    services: rows_("servicos").filter(s => s.ativo !== false && s.ativo !== "false")
      .map(s => ({ id:String(s.id), nome:String(s.nome), categoria:String(s.categoria || ""),
        preco:Number(s.preco || 0), duracaoMinutos:Number(s.duracaoMinutos),
        profissional:String(s.profissional || "") })),
    professionals: rows_("profissionais").filter(p => p.ativo !== false && p.ativo !== "false")
      .map(p => ({ id:String(p.id), nome:String(p.nome), especialidade:String(p.especialidade || "") }))
  };
}

function adminData_() {
  return {
    services: rows_("servicos"),
    professionals: rows_("profissionais").map(p => {
      p.agenda = parseJson_(p.agendaJson, {});
      return p;
    }),
    appointments: rows_("agendamentos")
  };
}

function saveService_(d) {
  const nome = clean_(d.nome, 100);
  const duracao = Number(d.duracaoMinutos);
  const preco = Number(d.preco);
  if (nome.length < 2 || !Number.isFinite(preco) || preco < 0 ||
      !Number.isInteger(duracao) || duracao < 5 || duracao > 480) {
    throw new Error("Confira nome, preço e duração do serviço.");
  }
  const all = rows_("servicos");
  const id = d.id ? clean_(d.id, 80) : Utilities.getUuid();
  const current = all.find(x => String(x.id) === id);
  const now = new Date().toISOString();
  const item = {
    id, nome, categoria:clean_(d.categoria,80), preco, duracaoMinutos:duracao,
    profissional:clean_(d.profissional,100), descricao:clean_(d.descricao,500),
    ativo: current ? current.ativo !== false && current.ativo !== "false" : true,
    criadoEm: current ? current.criadoEm : now, atualizadoEm:now
  };
  writeRow_("servicos", item, id);
  return { ok:true, item:item };
}

function saveProfessional_(d) {
  const nome = clean_(d.nome,100);
  if (nome.length < 2) throw new Error("Informe o nome da profissional.");
  const all = rows_("profissionais");
  const id = d.id ? clean_(d.id,80) : Utilities.getUuid();
  const current = all.find(x => String(x.id) === id);
  const now = new Date().toISOString();
  const item = {
    id, nome, especialidade:clean_(d.especialidade,100),
    ativo: current ? current.ativo !== false && current.ativo !== "false" : true,
    agendaJson: current ? current.agendaJson : JSON.stringify({}),
    criadoEm: current ? current.criadoEm : now, atualizadoEm:now
  };
  writeRow_("profissionais", item, id);
  item.agenda = parseJson_(item.agendaJson, {});
  return { ok:true, item:item };
}

function setActive_(table, d) {
  const id = clean_(d.id,80);
  const active = d.ativo === true;
  const all = rows_(table);
  const item = all.find(x => String(x.id) === id);
  if (!item) throw new Error("Registro não encontrado.");
  item.ativo = active;
  item.atualizadoEm = new Date().toISOString();
  writeRow_(table, item, id);
  return { ok:true };
}

function saveSchedule_(d) {
  const id = clean_(d.professionalId,80);
  const all = rows_("profissionais");
  const p = all.find(x => String(x.id) === id);
  if (!p) throw new Error("Profissional não encontrada.");
  const agenda = d.agenda || {};
  const keys = ["segunda","terca","quarta","quinta","sexta","sabado"];
  keys.forEach(key => {
    const day = agenda[key] || {};
    if (day.ativo && day.inicio && day.fim) {
      if (!validClock_(day.inicio) || !validClock_(day.fim) || clockMin_(day.fim) <= clockMin_(day.inicio)) {
        throw new Error("Confira os horários de entrada e saída.");
      }
      if (!!day.intervaloInicio !== !!day.intervaloFim) throw new Error("Preencha início e fim do intervalo.");
      if (day.intervaloInicio && (!validClock_(day.intervaloInicio) || !validClock_(day.intervaloFim) ||
          clockMin_(day.intervaloFim) <= clockMin_(day.intervaloInicio) ||
          clockMin_(day.intervaloInicio) < clockMin_(day.inicio) ||
          clockMin_(day.intervaloFim) > clockMin_(day.fim))) {
        throw new Error("O intervalo precisa ficar dentro do expediente.");
      }
    }
  });
  p.agendaJson = JSON.stringify(agenda);
  p.atualizadoEm = new Date().toISOString();
  writeRow_("profissionais", p, id);
  return { ok:true };
}

function availableSlots_(d) {
  const date = String(d.date || "");
  if (!validDate_(date)) throw new Error("Data inválida.");
  const catalog = publicCatalog_();
  const service = catalog.services.find(s => s.id === String(d.serviceId));
  const professional = rows_("profissionais").find(p => String(p.id) === String(d.professionalId) && p.ativo !== false && p.ativo !== "false");
  if (!service || !professional) return { slots:[] };
  if (!belongs_(service, professional)) return { slots:[] };
  const agenda = parseJson_(professional.agendaJson, {});
  const dayKey = ["domingo","segunda","terca","quarta","quinta","sexta","sabado"][new Date(date + "T12:00:00-03:00").getDay()];
  const schedule = agenda[dayKey];
  if (!schedule || !schedule.ativo || !schedule.inicio || !schedule.fim) return { slots:[] };
  const duration = Number(service.duracaoMinutos);
  const open = clockMin_(schedule.inicio), close = clockMin_(schedule.fim);
  const conflicts = rows_("agendamentos").filter(a => a.data === date &&
    String(a.profissionalId) === String(professional.id) && a.status !== "cancelado");
  const slots = [];
  for (let minute=open; minute+duration<=close; minute+=CONFIG.SLOT_MINUTES) {
    const time = clock_(minute);
    const start = localDate_(date,time);
    const end = start.getTime()+duration*60000;
    if (start.getTime() < Date.now()+CONFIG.MIN_ADVANCE_HOURS*3600000) continue;
    if (!fits_(schedule, time, clock_(minute+duration))) continue;
    if (!conflicts.some(a => start.getTime() < Number(a.fimMs) && end > Number(a.inicioMs))) slots.push(time);
  }
  return { slots:slots };
}

function createBooking_(d, source) {
  const serviceId = clean_(d.serviceId,80);
  const professionalId = clean_(d.professionalId,80);
  const date = String(d.date || "");
  const time = String(d.time || "");
  const customer = clean_(d.customer,100);
  const whatsapp = String(d.whatsapp || "").replace(/\D/g,"").slice(0,15);
  if (!validDate_(date) || !validClock_(time) || customer.length < 2 ||
      (source === "site" && whatsapp.length < 10)) throw new Error("Confira os dados do agendamento.");
  const catalog = publicCatalog_();
  const service = catalog.services.find(s => s.id === serviceId);
  const professional = rows_("profissionais").find(p => String(p.id) === professionalId &&
    p.ativo !== false && p.ativo !== "false");
  if (!service || !professional || !belongs_(service,professional)) throw new Error("Serviço ou profissional indisponível.");
  const duration = Number(service.duracaoMinutos);
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) throw new Error("Duração do serviço inválida.");
  const start = localDate_(date,time);
  if (start.getTime() < Date.now()+CONFIG.MIN_ADVANCE_HOURS*3600000 ||
      start.getTime() > Date.now()+CONFIG.MAX_DAYS_AHEAD*86400000) throw new Error("Escolha uma data entre 2 horas e 60 dias a partir de agora.");
  const end = start.getTime()+duration*60000;
  const agenda = parseJson_(professional.agendaJson,{});
  const dayKey = ["domingo","segunda","terca","quarta","quinta","sexta","sabado"][new Date(date+"T12:00:00-03:00").getDay()];
  const schedule = agenda[dayKey];
  if (!schedule || !schedule.ativo || !fits_(schedule,time,clock_(clockMin_(time)+duration))) {
    throw new Error("Horário fora da agenda configurada.");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  let item;
  try {
    const conflict = rows_("agendamentos").some(a => a.data === date &&
      String(a.profissionalId) === professionalId && a.status !== "cancelado" &&
      start.getTime() < Number(a.fimMs) && end > Number(a.inicioMs));
    if (conflict) throw new Error("Esse horário acabou de ser ocupado. Escolha outro.");
    if (source === "site") checkRateLimit_(whatsapp);
    const now = new Date().toISOString();
    item = {
      id:Utilities.getUuid(), cliente:customer, whatsapp:whatsapp,
      servico:service.nome, servicoId:service.id, profissional:professional.nome,
      profissionalId:professional.id, data:date, hora:time, duracaoMinutos:duration,
      valor:Number(service.preco||0), inicioMs:start.getTime(), fimMs:end,
      status:source === "painel" ? "confirmado" : "aguardando",
      origem:source, criadoEm:now, atualizadoEm:now, calendarEventId:""
    };
    writeRow_("agendamentos",item,item.id);
  } finally {
    lock.releaseLock();
  }

  try {
    const cal = CalendarApp.getDefaultCalendar();
    const title = (item.status === "aguardando" ? "Solicitação · " : "") + item.servico + " · " + item.cliente;
    const event = cal.createEvent(title,start,new Date(end),{
      description:"Cliente: "+item.cliente+"\nWhatsApp: "+item.whatsapp+
        "\nProfissional: "+item.profissional+"\nStatus: "+item.status+"\nOrigem: "+source
    });
    item.calendarEventId = event.getId();
    writeRow_("agendamentos",item,item.id);
  } catch (calendarError) {
    console.error("Falha ao sincronizar Google Calendar: "+calendarError);
  }

  if (source === "site") {
    try {
      MailApp.sendEmail(CONFIG.ADMIN_NOTIFICATION_EMAIL,
        "Novo pedido de agendamento — DG Nails",
        "Cliente: "+item.cliente+"\nServiço: "+item.servico+"\nProfissional: "+item.profissional+
        "\nData: "+date+" às "+time+"\nWhatsApp: "+item.whatsapp+"\n\nAcesse o painel para confirmar.");
    } catch (mailError) { console.error("Falha no aviso por e-mail: "+mailError); }
  }
  return { ok:true, appointmentId:item.id, status:item.status };
}

function updateBookingStatus_(d) {
  const id = clean_(d.appointmentId,80);
  const status = String(d.status || "");
  if (["aguardando","confirmado","concluido","cancelado"].indexOf(status) < 0) throw new Error("Status inválido.");
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  let item;
  try {
    item = rows_("agendamentos").find(a => String(a.id) === id);
    if (!item) throw new Error("Agendamento não encontrado.");
    if (status !== "cancelado") {
      const conflict = rows_("agendamentos").some(a => String(a.id)!==id &&
        a.data===item.data && String(a.profissionalId)===String(item.profissionalId) &&
        a.status!=="cancelado" && Number(item.inicioMs)<Number(a.fimMs) && Number(item.fimMs)>Number(a.inicioMs));
      if (conflict) throw new Error("Esse horário já está ocupado.");
    }
    item.status=status;
    item.atualizadoEm=new Date().toISOString();
    writeRow_("agendamentos",item,id);
  } finally { lock.releaseLock(); }

  if (item.calendarEventId) {
    try {
      const event=CalendarApp.getDefaultCalendar().getEventById(item.calendarEventId);
      if (event && status==="cancelado") event.deleteEvent();
      else if (event) event.setTitle((status==="aguardando"?"Solicitação · ":status==="confirmado"?"Confirmado · ":"")+
        item.servico+" · "+item.cliente);
    } catch (err) { console.error("Falha ao atualizar evento: "+err); }
  }
  return { ok:true };
}

function checkRateLimit_(phone) {
  const key = "dg_rate_" + Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,phone)
    .map(b => ("0"+(b&255).toString(16)).slice(-2)).join("");
  const cache = CacheService.getScriptCache();
  const old = JSON.parse(cache.get(key) || "[]").filter(t => Date.now()-t < 3600000);
  if (old.length >= 3) throw new Error("Limite de solicitações atingido para este WhatsApp. Tente novamente mais tarde.");
  old.push(Date.now());
  cache.put(key,JSON.stringify(old),3600);
}

function clean_(v,max) { return String(v==null?"":v).trim().replace(/[<>]/g,"").slice(0,max); }
function parseJson_(v,fallback) { try { return JSON.parse(v||""); } catch(e) { return fallback; } }
function validDate_(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v+"T12:00:00-03:00").getTime()); }
function validClock_(v) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v||"")); }
function clockMin_(v) { const p=String(v).split(":").map(Number); return p[0]*60+p[1]; }
function clock_(m) { return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0"); }
function localDate_(date,time) { return new Date(date+"T"+time+":00-03:00"); }
function belongs_(s,p) {
  const assigned=String(s.profissional||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  const name=String(p.nome||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  return !assigned || assigned==="todas" || assigned==="qualquer profissional" || assigned===name;
}
function fits_(s,start,end) {
  const a=clockMin_(start), b=clockMin_(end);
  if (a<clockMin_(s.inicio) || b>clockMin_(s.fim)) return false;
  if (s.intervaloInicio && s.intervaloFim) return !(a<clockMin_(s.intervaloFim) && b>clockMin_(s.intervaloInicio));
  return true;
}
function safeMessage_(err) { return String(err && err.message || err || "Erro inesperado.").slice(0,300); }
