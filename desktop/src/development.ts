import type { BrowserWindow } from "electron";

export type DevelopmentState = {
  live: boolean;
  pending: string[];
  phase: "ready" | "checking" | "applying" | "error";
  message: string;
  generation: number;
};

export class DevelopmentSession {
  state: DevelopmentState;
  constructor(
    live: boolean,
    private windows: () => BrowserWindow[],
    private onChange?: () => void,
  ) {
    this.state = {
      live,
      pending: [],
      phase: "ready",
      message: "页面修改即时更新",
      generation: 0,
    };
  }
  update(value: DevelopmentState) {
    this.state = value;
    for (const window of this.windows())
      window.webContents.send("desktop:development-state", value);
    this.onChange?.();
  }
  send(type: string, values: Record<string, unknown> = {}) {
    if (process.connected) process.send?.({ type, ...values });
  }
  apply() {
    this.send("apply");
  }
}
