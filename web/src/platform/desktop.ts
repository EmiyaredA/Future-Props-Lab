export type DesktopDevelopmentState = {
  live: boolean;
  pending: string[];
  phase: "ready" | "checking" | "applying" | "error";
  message: string;
  generation: number;
};

export type DesktopBridge = {
  version: number;
  status: () => Promise<{ phase: string; message: string }>;
  retry: () => Promise<void>;
  openLogs: () => Promise<void>;
  minimize: () => Promise<void>;
  close: () => Promise<void>;
  openNewWindow: () => Promise<void>;
  pickWebCredential?: (
    ticket: string,
    kind: "identity" | "known_hosts",
  ) => Promise<{ id: string; fingerprint: string } | null>;
  applyWebAccessConfig?: (receipt: string) => Promise<void>;
  onWebAccessPrepare?: (
    callback: (approve: () => void, cancel: () => void) => void,
  ) => () => void;
  saveExportFile?: (
    filename: string,
    bytes: Uint8Array,
  ) => Promise<{ id: string; path: string } | null>;
  revealExportFile?: (receiptId: string) => Promise<void>;
  pickStorageDirectory?: () => Promise<string | null>;
  openPresentationAudience?: (
    projectId: string,
    sessionId: string,
  ) => Promise<void>;
  openAmadeus?: () => Promise<void>;
  hideAmadeus?: () => Promise<void>;
  setAmadeusStageOpen?: (enabled: boolean) => Promise<boolean>;
  amadeusAlwaysOnTop?: () => Promise<boolean>;
  setAmadeusAlwaysOnTop?: (enabled: boolean) => Promise<boolean>;
  publishAmadeusMutation?: (value: unknown) => Promise<void>;
  locateAmadeusReference?: (value: unknown) => Promise<boolean>;
  onAmadeusMutation?: (callback: (value: unknown) => void) => () => void;
  onAmadeusLocate?: (callback: (value: unknown) => void) => () => void;
  publishAmadeusContext?: (value: unknown) => Promise<void>;
  amadeusContexts?: () => Promise<unknown>;
  setAmadeusPickMode?: (enabled: boolean, index?: number) => Promise<boolean>;
  finishAmadeusPick?: () => Promise<void>;
  addAmadeusReference?: (value: unknown) => Promise<void>;
  onAmadeusContexts?: (callback: (value: unknown) => void) => () => void;
  onAmadeusPickCommand?: (
    callback: (value: { enabled: boolean; index: number }) => void,
  ) => () => void;
  onAmadeusPickFinished?: (callback: () => void) => () => void;
  onAmadeusReference?: (callback: (value: unknown) => void) => () => void;
  agentStatus: () => Promise<{ enabled: boolean; connected: boolean }>;
  enableAgent: () => Promise<{ enabled: boolean; connected: boolean }>;
  disableAgent: () => Promise<{ enabled: boolean; connected: boolean }>;
  onQuitRequested: (
    callback: (approve: () => void, cancel: () => void) => void,
  ) => () => void;
  developmentStatus?: () => Promise<DesktopDevelopmentState | null>;
  applyDevelopmentUpdate?: () => Promise<void>;
  checkDevelopmentUpdate?: () => Promise<void>;
  onDevelopmentState?: (
    callback: (state: DesktopDevelopmentState) => void,
  ) => () => void;
  onDevelopmentMenuAction?: (
    callback: (action: "apply" | "check") => void,
  ) => () => void;
};

declare global {
  interface Window {
    futurePropsDesktop?: DesktopBridge;
  }
}
