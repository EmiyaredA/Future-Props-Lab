import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { getSources, getSessions, getSession, type Filters } from "./api";
import { workbenchKeys as keys } from "./queryKeys";

export function useWorkbench(
  owner: string,
  filters: Filters,
  selected?: string,
) {
  const queryClient = useQueryClient();
  const sources = useQuery({
    queryKey: keys.sources(owner),
    queryFn: ({ signal }) => getSources(signal),
    refetchInterval: 15000,
  });
  const list = useInfiniteQuery({
    queryKey: keys.list(owner, filters),
    queryFn: ({ pageParam, signal }) => getSessions(filters, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  const detail = useQuery({
    queryKey: keys.session(owner, selected ?? ""),
    enabled: !!selected,
    queryFn: ({ signal }) => getSession(selected!, signal),
  });
  const [paused, setPaused] = useState(false);
  const [connection, setConnection] = useState("connecting");
  const [updateError, setUpdateError] = useState("");
  const selectedRef = useRef(selected);
  const pausedRef = useRef(paused);
  selectedRef.current = selected;
  pausedRef.current = paused;
  const ready = !!list.data;
  const initialCursor = useRef(0);
  initialCursor.current = list.data?.pages[0].change_cursor ?? 0;
  useEffect(() => {
    if (!ready) return;
    const base = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
    const stream = new EventSource(
      `${base}/v1/agent-workbench/events?after=${initialCursor.current}`,
      { withCredentials: true },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: keys.lists(owner) });
      void queryClient.invalidateQueries({ queryKey: keys.sources(owner) });
      if (selectedRef.current && !pausedRef.current) {
        void queryClient.invalidateQueries({
          queryKey: keys.histories(owner, selectedRef.current),
        });
        void queryClient.invalidateQueries({
          queryKey: keys.session(owner, selectedRef.current),
        });
      }
    };
    const change = () => {
      // Coalesce bursts without delaying the source's durable cursor.
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          refresh();
        }, 120);
    };
    stream.onopen = () => setConnection("live");
    stream.onerror = () => setConnection("reconnecting");
    stream.addEventListener("change", change);
    const close = () => {
      stream.close();
      setConnection("closed");
    };
    stream.addEventListener("auth_expired", close);
    const focus = () => refresh();
    window.addEventListener("focus", focus);
    window.addEventListener("future-props:auth-required", close);
    return () => {
      stream.close();
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("future-props:auth-required", close);
    };
  }, [ready, owner, queryClient]);
  useEffect(
    () => () => {
      void queryClient.cancelQueries({ queryKey: keys.root(owner) });
      queryClient.removeQueries({ queryKey: keys.root(owner) });
    },
    [owner, queryClient],
  );

  const mutate = async (action: () => Promise<unknown>) => {
    setUpdateError("");
    try {
      await action();
    } catch (error) {
      setUpdateError(
        error instanceof Error ? error.message : "操作失败，请刷新后重试",
      );
    } finally {
      await queryClient.invalidateQueries({ queryKey: keys.root(owner) });
    }
  };
  const togglePaused = () => {
    if (paused && selected)
      void queryClient.invalidateQueries({
        queryKey: keys.histories(owner, selected),
      });
    setPaused(!paused);
  };
  return {
    sources,
    list,
    detail,
    paused,
    togglePaused,
    connection,
    mutate,
    updateError,
  };
}
