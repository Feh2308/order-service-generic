const PDFDocument = require("pdfkit");

function sanitizeFilePart(value) {
  const normalized = String(value || "cliente")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "cliente";
}

function currentYear() {
  return new Date().getFullYear();
}

function serviceDate(service) {
  return `${service.date || ""} ${service.time || ""}`.trim() || service.createdAt || "";
}

function formatMoney(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number.isFinite(number) ? number : 0);
}

function isPriced(service) {
  return service.priceStatus === "PRICED" && Number(service.price) > 0;
}

function priceLabel(service) {
  return isPriced(service) ? formatMoney(service.price) : "Aguardando preço";
}

function priceStatusLabel(service) {
  return isPriced(service) ? "PRECIFICADA" : "AGUARDANDO_PREÇO";
}

function employeeNames(db, service) {
  if (service.finishedBy) {
    const employee = db.employees.find((item) => item.id === service.finishedBy);
    if (employee) return employee.name;
  }
  return (service.employeeIds || [])
    .map((employeeId) => db.employees.find((employee) => employee.id === employeeId)?.name)
    .filter(Boolean)
    .join(", ") || "Sem funcionário";
}

function clientNameForService(db, service) {
  return service.clientId
    ? db.clients.find((client) => client.id === service.clientId)?.name || service.customer || "Cliente"
    : service.customer || "Cliente";
}

function filteredClientServices(db, clientId, filters, options) {
  const showPriced = options.pricedServices !== false;
  const showUnpriced = options.unpricedServices !== false;
  const status = String(filters.status || "all");
  const dateFrom = String(filters.dateFrom || "");
  const dateTo = String(filters.dateTo || "");

  return db.services
    .filter((service) => service.clientId === clientId)
    .filter((service) => status === "all" || service.status === status)
    .filter((service) => !dateFrom || service.date >= dateFrom)
    .filter((service) => !dateTo || service.date <= dateTo)
    .filter((service) => (isPriced(service) ? showPriced : showUnpriced))
    .slice()
    .sort((a, b) => serviceDate(a).localeCompare(serviceDate(b)));
}

function collectPdf(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function writeLine(doc, label, value) {
  doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
  doc.font("Helvetica").text(String(value || "Não informado"));
}

function ensureSpace(doc, needed = 80) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function drawHeader(doc, title, subtitle) {
  doc.font("Helvetica-Bold").fontSize(18).fillColor("#17211f").text(title);
  doc.font("Helvetica").fontSize(10).fillColor("#5f6f69").text(subtitle);
  doc.font("Helvetica").fontSize(10).text("Order Service");
  doc.moveDown();
  doc.fillColor("#17211f").fontSize(11);
}

function drawServicesTable(doc, db, services, options) {
  if (!services.length) {
    doc.font("Helvetica").text("Nenhum serviço encontrado.");
    return;
  }

  services.forEach((service) => {
    ensureSpace(doc, 120);
    const boxX = doc.x;
    const boxY = doc.y;
    doc.roundedRect(boxX, boxY, 500, 102, 6).strokeColor("#d9e3df").stroke();
    doc.x = boxX + 12;
    doc.y = boxY + 10;

    if (options.serviceName !== false) writeLine(doc, "Serviço", `${service.code} - ${service.title || ""}`);
    if (options.createdAt !== false) writeLine(doc, "Data", serviceDate(service));
    if (options.status !== false) writeLine(doc, "Status", service.status || "");
    if (options.priceStatus) writeLine(doc, "Precificação", priceStatusLabel(service));
    if (options.responsibleEmployee) writeLine(doc, "Responsável", employeeNames(db, service));
    if (options.price !== false) writeLine(doc, "Valor", priceLabel(service));
    if (options.financeNotes && service.financeNotes) writeLine(doc, "Obs. financeira", service.financeNotes);
    if (options.notes && service.notes) writeLine(doc, "Observações", service.notes);

    doc.x = boxX;
    doc.y = boxY + 114;
  });
}

async function drawSignature(doc, service, mediaLoader = null) {
  ensureSpace(doc, 170);
  doc.font("Helvetica-Bold").fontSize(13).text("Assinatura");
  doc.moveDown(0.4);
  if (!service.clientSignature?.imageDataUrl && !service.clientSignature?.storageKey && !service.clientSignature?.objectKey) {
    doc.font("Helvetica").fontSize(10).text("Sem assinatura registrada.");
    return;
  }

  writeLine(doc, "Assinante", service.clientSignature.signerName || "Cliente");
  const image = mediaLoader
    ? await mediaLoader.load(service.clientSignature)
    : imageBufferFromDataUrl(service.clientSignature.imageDataUrl);
  if (image) {
    try {
      doc.image(image, { fit: [260, 90] });
    } catch (_error) {
      doc.font("Helvetica").text("Assinatura registrada, mas não foi possível inserir a imagem no PDF.");
    }
  }
}

function imageBufferFromDataUrl(dataUrl) {
  const base64 = String(dataUrl || "").split(",")[1];
  return base64 ? Buffer.from(base64, "base64") : null;
}

async function drawServicePhoto(doc, title, photo, mediaLoader = null) {
  ensureSpace(doc, 220);
  doc.font("Helvetica-Bold").fontSize(12).text(title);
  doc.moveDown(0.3);
  if (!photo?.imageDataUrl && !photo?.storageKey && !photo?.objectKey) {
    doc.font("Helvetica").fontSize(10).text("Foto não registrada.");
    return;
  }

  const image = mediaLoader ? await mediaLoader.load(photo) : imageBufferFromDataUrl(photo.imageDataUrl);
  if (!image) {
    doc.font("Helvetica").fontSize(10).text("Foto registrada, mas não foi possível inserir a imagem.");
    return;
  }

  try {
    doc.image(image, { fit: [230, 170] });
    if (photo.capturedAt) doc.font("Helvetica").fontSize(9).text(`Capturada em ${photo.capturedAt}`);
  } catch (_error) {
    doc.font("Helvetica").fontSize(10).text("Foto registrada, mas não foi possível inserir a imagem no PDF.");
  }
  doc.moveDown();
}

async function drawServicePhotos(doc, service, mediaLoader = null) {
  ensureSpace(doc, 80);
  doc.font("Helvetica-Bold").fontSize(13).text("Fotos antes e depois");
  doc.moveDown(0.5);
  await drawServicePhoto(doc, "Foto antes", service.servicePhotos?.before, mediaLoader);
  await drawServicePhoto(doc, "Foto depois", service.servicePhotos?.after, mediaLoader);
}

async function createClientReportPdf({ db, clientId, filters = {}, options = {} }) {
  const client = db.clients.find((item) => item.id === clientId);
  if (!client) {
    const error = new Error("Cliente não encontrado.");
    error.statusCode = 404;
    throw error;
  }

  const safeClientName = sanitizeFilePart(client.name);
  const fileName = `relatorio_${safeClientName}_${currentYear()}.pdf`;
  const services = filteredClientServices(db, clientId, filters, options);
  const total = services.reduce((sum, service) => sum + (isPriced(service) ? Number(service.price) : 0), 0);

  const doc = new PDFDocument({ margin: 44, size: "A4" });
  const done = collectPdf(doc);
  drawHeader(doc, "Relatório do cliente", client.name);

  if (options.clientName !== false) writeLine(doc, "Cliente", client.name);
  if (options.phone !== false) writeLine(doc, "Telefone", client.phone || "");
  if (options.clientNotes) writeLine(doc, "Observações gerais", client.notes || "");
  if (options.period !== false) writeLine(doc, "Período", `${filters.dateFrom || "início"} até ${filters.dateTo || "hoje"}`);
  doc.moveDown();

  if (options.clientHistory !== false) {
    doc.font("Helvetica-Bold").fontSize(13).text("Serviços");
    doc.moveDown(0.4);
    doc.fontSize(10);
    drawServicesTable(doc, db, services, options);
  }

  if (options.totalValue !== false) {
    ensureSpace(doc, 60);
    doc.moveDown();
    doc.font("Helvetica-Bold").fontSize(13).text("Total financeiro");
    doc.font("Helvetica").fontSize(11).text(`${formatMoney(total)} em ${services.filter(isPriced).length} serviço(s) com preço.`);
  }

  doc.end();
  return { fileName, buffer: await done };
}

async function createServiceReportPdf({ db, serviceId, options = {}, mediaLoader = null }) {
  const service = db.services.find((item) => item.id === serviceId);
  if (!service) {
    const error = new Error("Serviço não encontrado.");
    error.statusCode = 404;
    throw error;
  }
  if (!isPriced(service)) {
    const error = new Error("Defina o preço antes de gerar o PDF.");
    error.statusCode = 409;
    throw error;
  }

  const client = service.clientId ? db.clients.find((item) => item.id === service.clientId) : null;
  const customerName = client?.name || service.customer || "Cliente";
  const fileName = `ordem_${sanitizeFilePart(customerName)}_${sanitizeFilePart(service.code)}.pdf`;
  const allClientServices = service.clientId
    ? filteredClientServices(db, service.clientId, { status: "all", dateFrom: "", dateTo: "" }, options)
    : [];
  const total = allClientServices.reduce((sum, item) => sum + (isPriced(item) ? Number(item.price) : 0), 0);

  const doc = new PDFDocument({ margin: 44, size: "A4" });
  const done = collectPdf(doc);
  drawHeader(doc, `Ordem de Serviço ${service.code}`, customerName);

  if (options.clientName !== false) writeLine(doc, "Cliente", customerName);
  if (options.phone !== false) writeLine(doc, "Telefone", client?.phone || "");
  if (options.serviceName !== false) writeLine(doc, "Serviço", service.title || "");
  if (options.description) writeLine(doc, "Descrição", service.notes || "");
  if (options.price !== false) writeLine(doc, "Valor", priceLabel(service));
  if (options.createdAt !== false) writeLine(doc, "Data de abertura", service.createdAt || serviceDate(service));
  if (options.finishedAt !== false) writeLine(doc, "Data de finalização", service.finishedAt || "");
  if (options.status !== false) writeLine(doc, "Status", service.status || "");
  if (options.priceStatus) writeLine(doc, "Precificação", priceStatusLabel(service));
  if (options.responsibleEmployee) writeLine(doc, "Responsável", employeeNames(db, service));
  if (options.notes) writeLine(doc, "Observações", service.notes || "");
  if (options.financeNotes) writeLine(doc, "Obs. financeira", service.financeNotes || "");
  doc.moveDown();

  if (options.signature) await drawSignature(doc, service, mediaLoader);
  if (options.photos !== false) await drawServicePhotos(doc, service, mediaLoader);
  if (options.clientHistory && allClientServices.length) {
    ensureSpace(doc, 100);
    doc.moveDown();
    doc.font("Helvetica-Bold").fontSize(13).text("Histórico do cliente");
    doc.moveDown(0.4);
    drawServicesTable(doc, db, allClientServices, options);
  }
  if (options.totalValue) {
    ensureSpace(doc, 60);
    doc.moveDown();
    doc.font("Helvetica-Bold").fontSize(13).text("Total financeiro do cliente");
    doc.font("Helvetica").fontSize(11).text(`${formatMoney(total)} em ${allClientServices.filter(isPriced).length} serviço(s) com preço.`);
  }

  doc.end();
  return { fileName, buffer: await done };
}

module.exports = {
  createClientReportPdf,
  createServiceReportPdf,
  sanitizeFilePart
};
