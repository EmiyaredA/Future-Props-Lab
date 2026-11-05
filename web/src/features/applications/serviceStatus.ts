import type { components } from "@generated/api";

export type ServicesStatus = components["schemas"]["ServicesStatusOut"];
export type ServiceStatus = components["schemas"]["ServiceStatusOut"];
export type ServicePhase = components["schemas"]["ServicePhase"];

export const servicePhaseLabels: Record<ServicePhase, string> = {
  running: "运行中",
  starting: "启动中",
  stopped: "已停止",
  paused: "已暂停",
  restarting: "重启中",
  unhealthy: "健康检查失败",
  failed: "运行异常",
  unreachable: "服务无响应",
  not_deployed: "未部署",
  unknown: "状态暂不可读",
  degraded: "功能受限",
};

export function serviceStatusTime(value?: string) {
  if (!value) return "尚未取得状态";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString("zh-CN", { hour12: false })
    : "尚未取得状态";
}
