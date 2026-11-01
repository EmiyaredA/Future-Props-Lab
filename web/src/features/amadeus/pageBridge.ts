import type { AmadeusPageBridge } from "./PageContext";
import type { Context, Reference } from "./protocol";

/** Every signed-in account owns its own bus. No browser or module-global mutable state. */
export function createPageBridge(
  userId: string,
  close: () => void,
): AmadeusPageBridge {
  const bus = new EventTarget();
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
  return {
    hideAmadeus: async () => {
      emit("pick", { enabled: false, index: 1 });
      emit("finished");
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
    addAmadeusReference: async (value) => {
      emit("reference", { ...value, windowId: 1 });
    },
    onAmadeusReference: (callback) => on<Reference>("reference", callback),
    setAmadeusPickMode: async (enabled, index = 1) => {
      emit("pick", { enabled, index });
      return enabled;
    },
    onAmadeusPickCommand: (callback) => on("pick", callback),
    finishAmadeusPick: async () => {
      emit("finished");
    },
    onAmadeusPickFinished: (callback) => on("finished", callback),
    locateAmadeusReference: async (value) => {
      emit("locate", value);
      return true;
    },
    onAmadeusLocate: (callback) => on("locate", callback),
    publishAmadeusMutation: async (value) => {
      emit("mutation", value);
      window.dispatchEvent(
        new CustomEvent("future-props:amadeus-mutation", { detail: value }),
      );
    },
    onAmadeusMutation: (callback) => on("mutation", callback),
  };
}
