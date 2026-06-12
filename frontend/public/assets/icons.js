(function () {
  function refresh() {
    if (!window.lucide?.createIcons) return;
    window.lucide.createIcons({
      attrs: {
        "aria-hidden": "true",
        "stroke-width": "2.2"
      }
    });
  }

  window.EGIcons = { refresh };
  document.addEventListener("DOMContentLoaded", refresh);
})();
