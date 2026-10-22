import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { interviewApi, activeTask, type Room } from "./api";
import { interviewQueryKeys as keys } from "./queryKeys";
import { example } from "./model";
import type { InterviewInput } from "./types";

export const snapshotOf = (room: Room) => {
  const task = room.tasks.find((task) => task.id === room.active_task_id);
  return task?.snapshot || null;
};

export function usePreparation(scope: string) {
  const cache = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<InterviewInput>({
    ...example,
    filename: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const mounted = useRef(true);
  const createRequest = useRef(crypto.randomUUID());
  const prepareRequest = useRef<{ signature: string; id: string } | null>(null);
  const restored = useRef(false);
  const invalidatePending = useCallback(() => {
    mounted.current = false;
    generation.current++;
    restored.current = false;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return invalidatePending;
  }, [invalidatePending]);
  const rooms = useQuery({
    queryKey: keys.rooms(scope),
    queryFn: interviewApi.rooms,
    retry: false,
  });
  const executor = useQuery({
    queryKey: keys.executor(scope),
    queryFn: interviewApi.executor,
    retry: false,
    staleTime: 30_000,
  });
  const current = useQuery({
    queryKey: keys.room(scope, selectedId),
    queryFn: () => interviewApi.room(selectedId!),
    enabled: !!selectedId && !busy,
    staleTime: 500,
    retry: false,
  });
  const room = current.data;
  const task = room?.tasks.find((task) => task.id === room.active_task_id);
  const progress = useQuery({
    queryKey: keys.progress(scope, room?.id || "", task?.id || ""),
    queryFn: () => interviewApi.progress(room!.id, task!.id),
    enabled: activeTask(task),
    retry: false,
    refetchInterval: activeTask(task) ? 1000 : false,
  });
  useEffect(() => {
    if (!progress.data || !room || !task || progress.data.id !== task.id)
      return;
    const value = progress.data;
    if (value.revision <= task.revision) return;
    cache.setQueryData<Room>(
      keys.room(scope, room.id),
      (previous) =>
        previous && {
          ...previous,
          tasks: previous.tasks.map((item) =>
            item.id === value.id ? { ...item, ...value } : item,
          ),
        },
    );
    if (!["queued", "running", "validating"].includes(value.status)) {
      void cache.invalidateQueries({ queryKey: keys.room(scope, room.id) });
      void cache.invalidateQueries({ queryKey: keys.rooms(scope) });
    }
  }, [cache, progress.data, room, scope, task]);
  const select = useCallback(
    async (summary: Pick<Room, "id">) => {
      const version = ++generation.current;
      setBusy(true);
      setError("");
      try {
        const next = await interviewApi.room(summary.id);
        if (!mounted.current || generation.current !== version) return;
        cache.setQueryData(keys.room(scope, next.id), next);
        setSelectedId(next.id);
        const input = snapshotOf(next);
        setForm(
          input
            ? {
                ...input,
                filename: input.material?.filename || "",
                assistant: "Codex",
              }
            : { ...example, filename: "" },
        );
        setMaterialId(input?.material?.id || null);
        setFile(null);
        setDirty(false);
        setEditing(!input);
        setError("");
        prepareRequest.current = null;
      } catch (cause) {
        if (mounted.current && generation.current === version)
          setError(cause instanceof Error ? cause.message : "读取场次失败");
      } finally {
        if (mounted.current && generation.current === version) setBusy(false);
      }
    },
    [cache, scope],
  );
  useEffect(() => {
    if (restored.current || !rooms.data) return;
    restored.current = true;
    if (rooms.data.items[0]) void select(rooms.data.items[0]);
  }, [rooms.data, select]);
  function updateForm(
    value: InterviewInput | ((previous: InterviewInput) => InterviewInput),
  ) {
    setForm(value);
    setDirty(true);
  }
  function newRoom() {
    generation.current++;
    setBusy(false);
    setSelectedId(null);
    setFile(null);
    setMaterialId(null);
    setForm({ ...example, filename: "" });
    setDirty(false);
    setEditing(true);
    setError("");
    createRequest.current = crypto.randomUUID();
    prepareRequest.current = null;
  }
  async function run(operation: () => Promise<Room>) {
    const version = generation.current;
    setBusy(true);
    setError("");
    try {
      const next = await operation();
      if (!mounted.current || generation.current !== version) return;
      await cache.cancelQueries({ queryKey: keys.room(scope, next.id) });
      cache.setQueryData(keys.room(scope, next.id), next);
      setSelectedId(next.id);
      await cache.invalidateQueries({ queryKey: keys.rooms(scope) });
      return next;
    } catch (cause) {
      if (mounted.current && generation.current === version) {
        setError(cause instanceof Error ? cause.message : "操作失败，请重试");
        if (selectedId)
          await cache.invalidateQueries({
            queryKey: keys.room(scope, selectedId),
          });
      }
    } finally {
      if (mounted.current && generation.current === version) setBusy(false);
    }
  }
  async function prepare() {
    const version = generation.current;
    const next = await run(async () => {
      let saved =
        room || (await interviewApi.create(form.role, createRequest.current));
      // Save the created identity before upload: failed requests must not create a second room.
      if (mounted.current && generation.current === version) {
        setSelectedId(saved.id);
        cache.setQueryData(keys.room(scope, saved.id), saved);
      }
      let uploaded = materialId;
      if (file) {
        saved = await interviewApi.upload(saved, file);
        uploaded = saved.materials.at(-1)!.id;
        if (mounted.current && generation.current === version) {
          setMaterialId(uploaded);
          setFile(null);
          cache.setQueryData(keys.room(scope, saved.id), saved);
        }
      }
      const body = {
        expected_revision: saved.revision,
        role: form.role,
        jd: form.jd,
        resume: form.resume,
        material_id: uploaded,
        duration: form.duration as "15" | "30" | "45" | "60",
      };
      const signature = JSON.stringify(body);
      if (prepareRequest.current?.signature !== signature)
        prepareRequest.current = { signature, id: crypto.randomUUID() };
      return interviewApi.prepare(saved.id, {
        ...body,
        request_id: prepareRequest.current.id,
      });
    });
    if (next) {
      setDirty(false);
      setEditing(false);
    }
  }
  async function cancel() {
    if (room && task) await run(() => interviewApi.cancel(room.id, task));
  }
  async function remove() {
    if (!room) return;
    setBusy(true);
    try {
      await interviewApi.remove(room);
      newRoom();
      await cache.invalidateQueries({ queryKey: keys.rooms(scope) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return {
    rooms,
    executor,
    current,
    room,
    task,
    form,
    setForm: updateForm,
    file,
    select,
    newRoom,
    prepare,
    cancel,
    remove,
    busy,
    error:
      error ||
      (current.error || rooms.error || executor.error || progress.error)
        ?.message,
    dirty,
    editing,
    setEditing,
    setMaterialId,
    chooseFile: (next: File | null) => {
      setFile(next);
      setMaterialId(null);
      setDirty(true);
    },
  };
}
