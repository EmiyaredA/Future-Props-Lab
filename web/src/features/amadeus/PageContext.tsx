import { createContext, useContext } from "react";
import type { Context, Reference } from "./protocol";

export type AmadeusPageBridge = {
  hideAmadeus: () => Promise<void>;
  amadeusContexts: () => Promise<Context[]>;
  publishAmadeusContext: (value: Partial<Context>) => Promise<void>;
  onAmadeusContexts: (callback: (value: Context[]) => void) => () => void;
  addAmadeusReference: (
    value: Omit<Reference, "windowId"> & {
      rect?: { x: number; y: number; width: number; height: number };
    },
  ) => Promise<void>;
  onAmadeusReference: (callback: (value: Reference) => void) => () => void;
  setAmadeusPickMode: (enabled: boolean, index?: number) => Promise<boolean>;
  onAmadeusPickCommand: (
    callback: (value: { enabled: boolean; index: number }) => void,
  ) => () => void;
  finishAmadeusPick: () => Promise<void>;
  onAmadeusPickFinished: (callback: () => void) => () => void;
  locateAmadeusReference: (value: unknown) => Promise<boolean>;
  onAmadeusLocate: (callback: (value: unknown) => void) => () => void;
  publishAmadeusMutation: (value: unknown) => Promise<void>;
  onAmadeusMutation: (callback: (value: unknown) => void) => () => void;
};

export const AmadeusPageContext = createContext<AmadeusPageBridge | null>(null);
export function useAmadeusBridge() {
  const bridge = useContext(AmadeusPageContext);
  if (!bridge) throw new Error("Amadeus must be inside its page provider");
  return bridge;
}
