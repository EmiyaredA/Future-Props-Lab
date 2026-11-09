import type { AmadeusPageBridge, ReferenceLocation } from "./PageContext";
import type { RegisterAssistantElements } from "@platform/assistantElements";
import { elementReference } from "./elementReferences";
import type { Context, Reference } from "./protocol";

/** Every signed-in account owns its own bus. No browser or module-global mutable state. */
export function createPageBridge(
  userId: string,
  close: () => void,
): AmadeusPageBridge {
  const bus = new EventTarget();
  let source: Parameters<RegisterAssistantElements>[0] | undefined;
  let locate: ((value: Reference) => Promise<ReferenceLocation>) | undefined;
  let picking = false;
  let context: Context = {
    windowId: 1,
    userId,
    accountId: userId,
    focused: true,
    path: location.pathname,
    title: document.title,
    application: "应用首页",
  };
  const emit = (name: string, detail?: unknown) =>
    bus.dispatchEvent(new CustomEvent(name, { detail }));
  function on<T>(name: string, callback: (value: T) => void) {
    const handler = (event: Event) =>
      callback((event as CustomEvent<T>).detail);
    bus.addEventListener(name, handler);
    return () => bus.removeEventListener(name, handler);
  }
  function finishPick() {
    if (!picking) return;
    picking = false;
    emit("pick", { enabled: false, index: 1 });
    emit("finished");
  }
  return {
    hideAmadeus: async () => {
      finishPick();
      close();
    },
    amadeusContexts: async () => [{ ...context }],
    publishAmadeusContext: async (value) => {
      context = {
        ...context,
        ...value,
        windowId: 1,
        userId,
        accountId: userId,
        focused: true,
      };
      emit("contexts", [{ ...context }]);
    },
    onAmadeusContexts: (callback) => on<Context[]>("contexts", callback),
    registerElementSource: (read) => {
      finishPick();
      source = read;
      return () => {
        if (source === read) {
          source = undefined;
          finishPick();
        }
      };
    },
    currentElementSource: () => source?.(),
    selectedAmadeusElements: () => {
      const current = source?.();
      return current
        ? current.selected().map((element) => ({
            ...elementReference(current, element),
            windowId: 1,
          }))
        : [];
    },
    addAmadeusReference: async (value) => {
      emit("reference", { ...value, windowId: 1 });
    },
    onAmadeusReference: (callback) => on<Reference>("reference", callback),
    setAmadeusPickMode: async (enabled, index = 1) => {
      if (enabled) {
        picking = true;
        emit("pick", { enabled, index });
      } else finishPick();
      return enabled;
    },
    onAmadeusPickCommand: (callback) => on("pick", callback),
    finishAmadeusPick: async () => finishPick(),
    onAmadeusPickFinished: (callback) => on("finished", callback),
    locateAmadeusReference: async (value) => locate?.(value) ?? "wrong-project",
    onAmadeusLocate: (callback) => {
      locate = callback;
      return () => {
        if (locate === callback) locate = undefined;
      };
    },
    publishAmadeusMutation: async (value) => {
      emit("mutation", value);
    },
    onAmadeusMutation: (callback) => on("mutation", callback),
  };
}
