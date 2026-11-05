import "./buildUpdate.css";

const build = document.querySelector<HTMLMetaElement>(
  'meta[name="fpl-build"]',
)?.content;

if (build) {
  let notified = false;
  const check = async () => {
    if (notified || document.visibilityState === "hidden") return;
    try {
      const response = await fetch("/build.json", { cache: "no-store" });
      if (!response.ok) return;
      const { build_id: current } = await response.json();
      if (typeof current !== "string" || current === build) return;
    } catch {
      return;
    }
    if (notified) return;
    notified = true;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", check);
    window.removeEventListener("vite:preloadError", check);
    const notice = document.createElement("aside");
    notice.className = "fpl-build-update";
    notice.setAttribute("aria-label", "版本更新");
    const message = document.createElement("span");
    message.setAttribute("role", "status");
    message.textContent = "新版本已就绪。保存当前编辑后可刷新。";
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.textContent = "刷新页面";
    refresh.onclick = () => window.location.reload();
    notice.append(message, refresh);
    document.body.append(notice);
  };
  const timer = window.setInterval(check, 15_000);
  document.addEventListener("visibilitychange", check);
  window.addEventListener("vite:preloadError", check);
  void check();
}
