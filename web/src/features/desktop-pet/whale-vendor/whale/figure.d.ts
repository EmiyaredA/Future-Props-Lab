export interface WhaleFigure {
  setScheme(id: string, options?: { fade?: number }): Promise<void> | void;
}
export function createWhaleFigure(
  base: URL | undefined,
  options: {
    model: Record<string, unknown>;
    asset: (path: string) => string;
    scheme: string;
  },
): Promise<WhaleFigure>;
