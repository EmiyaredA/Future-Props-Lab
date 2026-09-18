async function update() {
  if (!window.futurePropsDesktop?.status) return;
  const state = await window.futurePropsDesktop.status();
  document.body.dataset.phase = state.phase;
  document.getElementById("message").textContent = state.message;
  document.getElementById("retry").hidden = state.phase !== "failed";
  document.getElementById("progress").hidden = state.phase === "failed";
}
document.getElementById("retry").onclick = () =>
  window.futurePropsDesktop.retry();
document.getElementById("logs").onclick = () =>
  window.futurePropsDesktop.openLogs();
setInterval(() => void update(), 500);
void update();
