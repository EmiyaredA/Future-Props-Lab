import type { AmadeusMutation } from "@platform/assistant";
import { createContext, useContext } from "react";
import type {
  AssistantElementSource,
  RegisterAssistantElements,
} from "@platform/assistantElements";
import type { Context, Reference } from "./protocol";

export type ReferenceLocation =
  "found" | "wrong-project" | "missing" | "failed";

export type AmadeusPageBridge = {
  hideAmadeus: () => Promise<void>;
  amadeusContexts: () => Promise<Context[]>;
  publishAmadeusContext: (value: Partial<Context>) => Promise<void>;
  onAmadeusContexts: (callback: (value: Context[]) => void) => () => void;
  registerElementSource: RegisterAssistantElements;
  currentElementSource: () => AssistantElementSource | undefined;
  selectedAmadeusElements: () => Reference[];
  addAmadeusReference: (value: Reference) => Promise<void>;
  onAmadeusReference: (callback: (value: Reference) => void) => () => void;
  setAmadeusPickMode: (enabled: boolean, index?: number) => Promise<boolean>;
  onAmadeusPickCommand: (
    callback: (value: { enabled: boolean; index: number }) => void,
  ) => () => void;
  finishAmadeusPick: () => Promise<void>;
  onAmadeusPickFinished: (callback: () => void) => () => void;
  locateAmadeusReference: (value: Reference) => Promise<ReferenceLocation>;
  onAmadeusLocate: (
    callback: (value: Reference) => Promise<ReferenceLocation>,
  ) => () => void;
  publishAmadeusMutation: (value: AmadeusMutation) => Promise<void>;
  onAmadeusMutation: (callback: (value: AmadeusMutation) => void) => () => void;
};

export const AmadeusPageContext = createContext<AmadeusPageBridge | null>(null);
export function useAmadeusBridge() {
  const bridge = useContext(AmadeusPageContext);
  if (!bridge) throw new Error("Amadeus must be inside its page provider");
  return bridge;
}
