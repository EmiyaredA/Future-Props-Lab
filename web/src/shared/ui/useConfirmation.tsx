import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { ConfirmDialog } from "./ConfirmDialog";

type Confirmation = Pick<
  ComponentProps<typeof ConfirmDialog>,
  "title" | "description" | "confirmLabel" | "cancelLabel" | "tone"
>;

/** Await an explicit decision without blocking the browser or keeping stale work alive. */
export function useConfirmation({
  portalContainer,
  pending = false,
}: {
  portalContainer?: HTMLElement | null;
  pending?: boolean;
} = {}) {
  const [request, setRequest] = useState<Confirmation>();
  const resolve = useRef<((accepted: boolean) => void) | null>(null);
  useEffect(
    () => () => {
      resolve.current?.(false);
      resolve.current = null;
    },
    [],
  );

  const confirm = useCallback((options: Confirmation) => {
    // A second action must not replace the decision that is already on screen.
    if (resolve.current) return Promise.resolve(false);
    return new Promise<boolean>((finish) => {
      resolve.current = finish;
      setRequest(options);
    });
  }, []);

  function settle(accepted: boolean) {
    const finish = resolve.current;
    resolve.current = null;
    setRequest(undefined);
    finish?.(accepted);
  }

  return {
    confirm,
    dialog: request ? (
      <ConfirmDialog
        {...request}
        open
        pending={pending}
        portalContainer={portalContainer}
        onCancel={() => settle(false)}
        onConfirm={() => settle(true)}
      />
    ) : null,
  };
}
