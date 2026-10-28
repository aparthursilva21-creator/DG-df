/**
 * Backend do agendamento da DG Nails (Google Apps Script).
 * Cole este arquivo inteiro em script.google.com e preencha as duas listas abaixo.
 */

// 1) IDs das agendas do Google (Google Agenda > Configurações da agenda >
//    Integrar agenda > "ID da agenda"). Os nomes à esquerda (dionesia, marcia,
//    ingridy) precisam ser iguais aos "id" das profissionais no agendamento.html.
const AGENDAS = {
  dionesia: "COLE_AQUI_O_ID_DA_AGENDA_DA_DIONESIA",
  marcia:   "COLE_AQUI_O_ID_DA_AGENDA_DA_MARCIA",
  ingridy:  "COLE_AQUI_O_ID_DA_AGENDA_DA_INGRIDY"
};

// 2) Aviso automático por WhatsApp (via CallMeBot, gratuito e não oficial).
//    fone  = 55 + DDD + número, só dígitos.
//    chave = apikey que o CallMeBot entrega para cada profissional.
//    Deixe chave "" para NÃO enviar WhatsApp para aquela profissional.
//    ATENÇÃO: nunca coloque essas chaves no agendamento.html, só aqui.
const AVISO = {
  dionesia: { fone: "5561993895357",  chave: "" },
  marcia:   { fone: "55COLE_O_NUMERO", chave: "" },
  ingridy:  { fone: "55COLE_O_NUMERO", chave: "" }
};

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// A página chama isto para saber quais horários já estão ocupados.
function doGet(e) {
  const ini = new Date(e.parameter.inicio + "T00:00:00-03:00");
  const fim = new Date(e.parameter.fim + "T23:59:59-03:00");
  const out = {};
  for (const id in AGENDAS) {
    out[id] = CalendarApp.getCalendarById(AGENDAS[id]).getEvents(ini, fim)
      .map(ev => [ev.getStartTime().getTime(), ev.getEndTime().getTime()]);
  }
  return resposta(out);
}

// A página chama isto quando a cliente confirma o agendamento.
function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  const agenda = AGENDAS[d.prof];
  const inicio = new Date(d.inicio);
  const dur = Number(d.duracao);
  const nome = String(d.nome || "").trim().slice(0, 60);
  const zap = String(d.zap || "").replace(/\D/g, "").slice(0, 15);
  const limite = new Date(Date.now() + 60 * 864e5);

  if (!agenda || isNaN(inicio) || !(dur > 0 && dur <= 480) ||
      nome.length < 2 || zap.length < 10 || inicio < new Date() || inicio > limite) {
    return resposta({ ok: false, erro: "invalido" });
  }

  const fim = new Date(inicio.getTime() + dur * 60000);
  const lock = LockService.getScriptLock(); // evita duas clientes pegarem o mesmo horário
  lock.waitLock(15000);
  try {
    const cal = CalendarApp.getCalendarById(agenda);
    if (cal.getEvents(inicio, fim).length) return resposta({ ok: false, erro: "ocupado" });
    cal.createEvent(String(d.servico).slice(0, 80) + " · " + nome, inicio, fim, {
      description: "Cliente: " + nome + "\nWhatsApp: " + zap + "\nAgendado pelo site"
    });
  } finally {
    lock.releaseLock();
  }

  avisar(d.prof, String(d.servico), nome, zap, inicio);
  return resposta({ ok: true });
}

function avisar(id, servico, nome, zap, inicio) {
  const a = AVISO[id];
  if (!a || !a.chave) return;
  const quando = Utilities.formatDate(inicio, "America/Sao_Paulo", "dd/MM 'às' HH:mm");
  const texto = "Novo agendamento pelo site: " + servico + ", " + quando +
                ". Cliente: " + nome + " (" + zap + ").";
  try {
    UrlFetchApp.fetch("https://api.callmebot.com/whatsapp.php?phone=" + a.fone +
      "&text=" + encodeURIComponent(texto) + "&apikey=" + a.chave, { muteHttpExceptions: true });
  } catch (err) {} // se o aviso falhar, o agendamento continua valendo
}
