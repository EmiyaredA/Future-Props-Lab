import { useEffect } from "react";
export function useManagementDraft(
  id: string,
  dirty: boolean,
  onDirty?: (dirty: boolean) => void,
) {
  useEffect(() => {
    onDirty?.(dirty);
    window.dispatchEvent(
      new CustomEvent("future-props:management-draft", {
        detail: { id, dirty },
      }),
    );
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    if (dirty) window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.dispatchEvent(
        new CustomEvent("future-props:management-draft", {
          detail: { id, dirty: false },
        }),
      );
    };
  }, [id, dirty, onDirty]);
}
