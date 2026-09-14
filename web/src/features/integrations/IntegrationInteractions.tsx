import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { integrationKeys } from "./queryKeys";
import {
  IntegrationInteractionContext as Context,
  type NavigationGuard,
} from "./interaction";
export function IntegrationInteractions({
  children,
  registerNavigationGuard,
}: {
  children: ReactNode;
  registerNavigationGuard?: (guard: NavigationGuard | null) => void;
}) {
  const guards = useRef(new Set<NavigationGuard>());
  const client = useQueryClient();
  const [guardCount, setGuardCount] = useState(0);
  const [pending, setPending] = useState<string[]>([]);
  const register = useCallback((guard: NavigationGuard) => {
    guards.current.add(guard);
    setGuardCount(guards.current.size);
    return () => {
      guards.current.delete(guard);
      setGuardCount(guards.current.size);
    };
  }, []);
  const blocked = useCallback(() => guards.current.size > 0, []);
  useEffect(() => {
    if (!guardCount) return;
    registerNavigationGuard?.((proceed) => {
      const guard = [...guards.current].at(-1);
      return guard ? guard(proceed) : false;
    });
    return () => registerNavigationGuard?.(null);
  }, [registerNavigationGuard, guardCount]);
  useEffect(() => {
    const change = (event: Event) => {
      const kinds = (event as CustomEvent<string[]>).detail;
      if (blocked()) setPending((old) => [...new Set([...old, ...kinds])]);
      else
        kinds.forEach((kind) => {
          void client.invalidateQueries({
            queryKey: integrationKeys.catalog(kind),
          });
        });
    };
    window.addEventListener("future-props:integration-change", change);
    return () =>
      window.removeEventListener("future-props:integration-change", change);
  }, [client, blocked]);
  return (
    <Context.Provider value={{ register, blocked }}>
      {pending.length > 0 && (
        <div className="integration-message" role="status">
          集成已被外部更新，当前输入已保留。
          <button
            className="btn small"
            onClick={() => {
              if (blocked()) return;
              pending.forEach((kind) => {
                void client.invalidateQueries({
                  queryKey: integrationKeys.catalog(kind),
                });
              });
              setPending([]);
            }}
          >
            处理完当前编辑后查看更新
          </button>
        </div>
      )}
      {children}
    </Context.Provider>
  );
}
