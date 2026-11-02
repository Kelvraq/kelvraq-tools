(() => {
  const invoke = (...args) => window.__TAURI__.core.invoke(...args);
  const request = (op, ...args) =>
    invoke("dispatch", { op, args })
      .then((data) => ({ ok: true, data }))
      .catch((error) => ({ ok: false, error: String(error) }));
  window.desktop = Object.fromEntries(
    [
      "bootstrap",
      "video_source",
      "search_start",
      "search_status",
      "search_cancel",
      "list",
      "entries",
      "pick",
      "open",
      "reveal",
      "mkdir",
      "rename",
      "trash",
      "settings",
      "icon",
      "window",
      "watch",
      "pick_applications",
      "add_applications",
      "remove_application",
      "launch_application",
    ].map((op) => [op, (...args) => request(op, ...args)]),
  );
  window.desktop.onFilesChanged = (fn) =>
    window.__TAURI__.event.listen("files-changed", (event) =>
      fn(event.payload),
    );
  window.desktop.onHistory = (fn) =>
    window.__TAURI__.event.listen("navigate-history", (event) =>
      fn(event.payload),
    );
  window.desktop.onMaximized = (fn) =>
    window.__TAURI__.event.listen("maximized", (event) => fn(event.payload));
  document.addEventListener("DOMContentLoaded", () => {
    const bar = document.querySelector(".titlebar");
    bar?.addEventListener("mousedown", (event) => {
      if (
        event.button === 0 &&
        event.detail !== 2 &&
        !event.target.closest("button")
      )
        window.__TAURI__.window.getCurrentWindow().startDragging();
    });
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.altKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      document
        .querySelector(event.key === "ArrowLeft" ? "#back" : "#forward")
        ?.click();
    }
  });
})();
