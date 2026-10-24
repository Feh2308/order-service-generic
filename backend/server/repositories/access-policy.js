function isAssigned(service, employeeId, team = null) {
  return Boolean(
    service?.employeeIds?.includes(employeeId) ||
    team?.employeeIds?.includes(employeeId)
  );
}

function canStartService(service, employeeId, team = null) {
  return isAssigned(service, employeeId, team) && (!team || team.leaderId === employeeId);
}

function canFinishService(service, employeeId, team = null) {
  return service?.status === "in_progress" && isAssigned(service, employeeId, team);
}

module.exports = { canFinishService, canStartService, isAssigned };
