const QUEUE_KEY = "offline_queue";

function getQueue() {
  return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
}

function saveQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

window.OfflineQueue = {
  add(action) {
    const queue = getQueue();
    queue.push(action);
    saveQueue(queue);
  },

  get() {
    return getQueue();
  },

  clear() {
    saveQueue([]);
  }
};