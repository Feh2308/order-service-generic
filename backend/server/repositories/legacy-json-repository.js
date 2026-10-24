const { assertRepository } = require("./repository-contract");

class LegacyJsonRepository {
  constructor(store) {
    this.store = store;
  }

  getDashboard() { return this.store.dashboard(); }
  listEmployees() { return this.store.db.employees; }
  listClients() { return this.store.db.clients; }
  listMaterials() { return this.store.db.materials; }
  listTeams() { return this.store.db.teams; }
  listServicesFor(user, filters) { return this.store.listServicesFor(user, filters); }
  createClient(payload) { return this.store.createClient(payload); }
  updateClient(id, payload) { return this.store.updateClient(id, payload); }
  createService(payload, adminId) { return this.store.createService(payload, adminId); }
  updateService(id, payload) { return this.store.updateService(id, payload); }
  startService(id, employeeId, payload) { return this.store.startService(id, employeeId, payload); }
  finishService(id, employeeId, payload) { return this.store.finishService(id, employeeId, payload); }
  priceService(id, adminId, payload) { return this.store.priceService(id, adminId, payload); }
  receiveServicePayment(id, adminId, payload) { return this.store.receiveServicePayment(id, adminId, payload); }
  addServiceUpdate(id, employeeId, payload) { return this.store.addServiceUpdate(id, employeeId, payload); }
  addEvent(type, message, details) { return this.store.addEvent(type, message, details); }
}

function createLegacyJsonRepository(store) {
  return assertRepository(new LegacyJsonRepository(store));
}

module.exports = { LegacyJsonRepository, createLegacyJsonRepository };
