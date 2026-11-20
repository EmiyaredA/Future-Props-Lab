export type SceneDocument = Record<string, unknown>;
type NamedMedia = { file: File; label: string };
export type SceneExport = {
  overview?: NamedMedia;
  sheet?: NamedMedia;
  previs?: NamedMedia;
  shots: { number?: number; frame?: NamedMedia; views?: NamedMedia; clip?: NamedMedia }[];
};
export type ProjectSceneModel = {
  id: string;
  name: string;
  kind: "model";
  category: "本地";
  path: string;
  bytes: number;
  normalize?: boolean;
};
export type TrumanHostProps = {
  document: SceneDocument;
  readOnly: boolean;
  saving: boolean;
  statusMessage: string;
  error: string;
  onChange: (document: SceneDocument) => void;
  onSave: () => void;
  onClose: () => void;
  projectModels?: ProjectSceneModel[];
  loadProjectModel?: (path?: string) => Promise<ArrayBuffer>;
  prepareProjectModel?: (asset: ProjectSceneModel, signal: AbortSignal) => Promise<ProjectSceneModel>;
  importProjectModel?: (file: File, signal: AbortSignal) => Promise<ProjectSceneModel>;
  beforeExport?: (signal: AbortSignal) => Promise<void>;
  exportCanvas?: {
    check: (needs: { image: boolean; video: boolean }) => void;
    deliver: (
      bundle: SceneExport,
      signal: AbortSignal,
      onItem?: () => void,
    ) => Promise<number>;
  };
};
export function validateScene(value: unknown): SceneDocument;
export function scriptSetOptions(script: string): { suggested: string; items: { id: string; name: string }[] };
export function mountTrumanMap(
  element: HTMLElement,
  props: TrumanHostProps,
): {
  isBusy(): boolean;
  playPreview(): void;
  buildScript(script: string, template?: string): Promise<{
    shots: { shot: number; camera: string; start: number; end: number }[];
    characters: string[];
    notice?: string;
  }>;
  update(next: TrumanHostProps): void;
  dispose(): void;
};
