import { cloudAgentPath, legacyAgentPath } from "@app/routing/legacyAgent";
import { recoverPage } from "@app/recovery";
import { startBootLoading } from "@app/bootLoading";
import "@app/recovery.css";

// Keep this entry independent of React and feature modules: import failures must stay visible.
if (legacyAgentPath.test(window.location.pathname)) {
  window.history.replaceState({}, "", cloudAgentPath);
}
const stopBootLoading = startBootLoading();
void import("./website").then(stopBootLoading).catch((error: unknown) => {
  stopBootLoading();
  const root = document.getElementById("root")!;
  const panel = document.createElement("section");
  panel.className = "fpl-recovery";
  panel.setAttribute("role", "alert");
  const title = document.createElement("h1");
  title.textContent = "页面资源加载失败";
  const message = document.createElement("p");
  message.textContent =
    "开发更新或网络中断可能使页面资源暂时不可用。请检查更新状态后重新加载。";
  const summary = document.createElement("pre");
  summary.textContent = (
    error instanceof Error ? error.message : String(error)
  ).slice(0, 500);
  panel.append(title, message, summary);
  for (const [label, home] of [
    ["重新加载", false],
    ["返回首页", true],
  ] as const) {
    const button = document.createElement("button");
    button.textContent = label;
    button.onclick = () => recoverPage(home);
    panel.append(button);
  }
  root.replaceChildren(panel);
});
