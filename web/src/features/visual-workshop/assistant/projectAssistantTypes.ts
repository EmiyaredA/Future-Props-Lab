export type ProjectAssistantPanelProps = {
  projectId: string;
  open: boolean;
  onClose: () => void;
  prepareCanvas: () => Promise<number>;
};
