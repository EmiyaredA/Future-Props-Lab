export type DesktopBridge = {
  version: number;
  status: () => Promise<{ phase: string; message: string }>;
  retry: () => Promise<void>;
  openLogs: () => Promise<void>;
  minimize: () => Promise<void>;
  close: () => Promise<void>;
  agentStatus: () => Promise<{ enabled: boolean; connected: boolean }>;
  enableAgent: () => Promise<{ enabled: boolean; connected: boolean }>;
  disableAgent: () => Promise<{ enabled: boolean; connected: boolean }>;
  onQuitRequested: (callback: (approve: () => void) => void) => () => void;
};

declare global {
  interface Window {
    futurePropsDesktop?: DesktopBridge;
  }
}
