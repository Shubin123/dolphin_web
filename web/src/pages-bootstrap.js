// GitHub Pages cannot set COOP/COEP headers; isolate via a same-origin worker.
async function start() {
  if (!crossOriginIsolated) {
    if (!("serviceWorker" in navigator) || !isSecureContext) throw new Error("Use HTTPS or localhost with service-worker support.");
    const registration = await navigator.serviceWorker.register(new URL("../coi-serviceworker.js", import.meta.url), { scope: new URL("../", import.meta.url).pathname });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
      return;
    }
    if (!sessionStorage.getItem("dolphin-isolation-reload")) {
      sessionStorage.setItem("dolphin-isolation-reload", "1");
      location.reload();
      return;
    }
    throw new Error("Cross-origin isolation failed. Enable service workers and reload this page.");
  }
  sessionStorage.removeItem("dolphin-isolation-reload");
  await import("./bootstrap.js");
}
start().catch(error => {
  console.error(error);
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = `Unable to start Dolphin: ${error.message}`;
  document.body.prepend(message);
});
