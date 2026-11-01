import type {
  PetPreviewIdentity,
  PetPreviewDraft,
  PetPreviewDelivery,
  PetPreviewStatus,
} from "./petPreview";
import type {
  PetEnvironment,
  PetMotionRequest,
  PetMotionReceipt,
} from "./petMotion";

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
  openPet?: (projectId: string) => Promise<void>;
  closePet?: () => Promise<void>;
  petStatus?: () => Promise<{ projectId: string | null; visible: boolean }>;
  notifyPetResourcesChanged?: (projectId: string) => Promise<void>;
  onPetResourcesChanged?: (callback: () => void) => () => void;
  beginPetPreview?: (value: PetPreviewIdentity) => Promise<PetPreviewStatus>;
  updatePetPreview?: (value: PetPreviewDraft) => Promise<PetPreviewStatus>;
  endPetPreview?: (sessionId: string) => Promise<void>;
  currentPetPreview?: () => Promise<PetPreviewDelivery>;
  reportPetPreview?: (value: {
    sessionId: string;
    sequence: number;
    state: "error";
    message: string;
  }) => Promise<void>;
  onPetPreview?: (callback: (value: PetPreviewDelivery) => void) => () => void;
  onPetPreviewStatus?: (
    callback: (value: PetPreviewStatus) => void,
  ) => () => void;
  publishPetContext?: (
    value: { userId: string; accountId: string } | null,
  ) => Promise<void>;
  setPetInteractive?: (interactive: boolean) => Promise<void>;
  petEnvironment?: () => Promise<PetEnvironment>;
  movePetFrame?: (value: PetMotionRequest) => Promise<PetEnvironment>;
  cancelPetMotion?: (generation: number) => Promise<PetEnvironment>;
  onPetEnvironment?: (callback: (value: PetEnvironment) => void) => () => void;
  onPetMotionConfirmed?: (
    callback: (value: PetMotionReceipt) => void,
  ) => () => void;
  movePet?: (
    x: number,
    y: number,
  ) => Promise<{ x: number; y: number; width: number; height: number }>;
  hidePet?: () => Promise<void>;
  showStudioFromPet?: () => Promise<void>;
  openPetChat?: () => Promise<void>;
  openPetChatFromStudio?: (projectId: string) => Promise<void>;
  closePetChat?: () => Promise<void>;
  setPetChatLayout?: (
    layout: "compact" | "expanded",
  ) => Promise<{ side: "left" | "right" }>;
  setPetChatInteractive?: (interactive: boolean) => Promise<void>;
  onPetChatLayout?: (
    callback: (value: { side: "left" | "right" }) => void,
  ) => () => void;
  sendPetChatState?: (value: {
    phase: "thinking" | "speaking" | "done" | "error";
    text: string;
  }) => Promise<void>;
  onPetChatState?: (
    callback: (value: { phase: string; text?: string }) => void,
  ) => () => void;
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
