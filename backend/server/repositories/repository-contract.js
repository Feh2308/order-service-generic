const REQUIRED_METHODS = Object.freeze([
  "getDashboard",
  "listEmployees",
  "listClients",
  "listMaterials",
  "listTeams",
  "listServicesFor",
  "createClient",
  "updateClient",
  "createService",
  "updateService",
  "startService",
  "finishService",
  "priceService",
  "receiveServicePayment",
  "addServiceUpdate",
  "addEvent"
]);

function assertRepository(repository) {
  const missing = REQUIRED_METHODS.filter((method) => typeof repository?.[method] !== "function");
  if (missing.length) throw new Error(`Repositório incompleto: ${missing.join(", ")}.`);
  return repository;
}

module.exports = { REQUIRED_METHODS, assertRepository };
