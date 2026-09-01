import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@platform/api/client";
import {
  putVisualCanvas,
  type VisualCanvasDocument,
  type VisualCanvasEdge,
  type VisualCanvasNode,
} from "@features/visual-workshop/api";

export function useCanvasPersistence(
  projectId: string,
  loaded: VisualCanvasDocument | undefined,
) {
  const revisionRef = useRef(0);
  const nodesRef = useRef<VisualCanvasNode[]>([]);
  const edgesRef = useRef<VisualCanvasEdge[]>([]);
  const conflictRef = useRef(false);
  const saveFailureRef = useRef("");
  const saveQueue = useRef(Promise.resolve());
  const autoSave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [nodes, setNodes] = useState<VisualCanvasNode[]>([]);
  const [edges, setEdges] = useState<VisualCanvasEdge[]>([]);
  const [saveState, setSaveState] = useState<
    "saved" | "saving" | "error" | "conflict"
  >("saved");
  const [saveMessage, setSaveMessage] = useState("");
  const [conflict, setConflict] = useState<VisualCanvasDocument>();

  useEffect(() => {
    if (!loaded) return;
    nodesRef.current = loaded.nodes;
    edgesRef.current = loaded.edges;
    revisionRef.current = loaded.revision;
    setNodes(loaded.nodes);
    setEdges(loaded.edges);
  }, [loaded]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);
  useEffect(
    () => () => {
      if (autoSave.current) clearTimeout(autoSave.current);
    },
    [],
  );

  const enqueueSave = useCallback(
    (snapshot: VisualCanvasNode[], edgeSnapshot = edgesRef.current) => {
      const nodeCopy = structuredClone(snapshot);
      const edgeCopy = structuredClone(edgeSnapshot);
      saveQueue.current = saveQueue.current.then(async () => {
        if (conflictRef.current) return;
        setSaveState("saving");
        setSaveMessage("");
        saveFailureRef.current = "";
        try {
          const updated = await putVisualCanvas(
            projectId,
            nodeCopy,
            revisionRef.current,
            edgeCopy,
          );
          revisionRef.current = updated.revision;
          setSaveState("saved");
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            const current = error.problem.current as
              VisualCanvasDocument | undefined;
            if (current) {
              conflictRef.current = true;
              setConflict(current);
              setSaveState("conflict");
              return;
            }
          }
          setSaveState("error");
          const message =
            error instanceof Error ? error.message : "画布保存失败";
          saveFailureRef.current = message;
          setSaveMessage(message);
        }
      });
    },
    [projectId],
  );

  const prepareCanvasForAgent = useCallback(async () => {
    if (autoSave.current) {
      clearTimeout(autoSave.current);
      autoSave.current = undefined;
      enqueueSave(nodesRef.current);
    }
    await saveQueue.current;
    if (conflictRef.current)
      throw new Error("画布存在保存冲突，请先选择要使用的版本");
    if (saveFailureRef.current)
      throw new Error(`画布尚未保存：${saveFailureRef.current}`);
    return revisionRef.current;
  }, [enqueueSave]);

  const replaceNodes = useCallback(
    (
      updater:
        | VisualCanvasNode[]
        | ((current: VisualCanvasNode[]) => VisualCanvasNode[]),
      immediate = false,
    ) => {
      setNodes((current) => {
        const next = typeof updater === "function" ? updater(current) : updater;
        nodesRef.current = next;
        if (autoSave.current) clearTimeout(autoSave.current);
        if (immediate) enqueueSave(next);
        else
          autoSave.current = setTimeout(
            () => enqueueSave(nodesRef.current),
            650,
          );
        return next;
      });
    },
    [enqueueSave],
  );
  const patchNode = useCallback(
    (nodeId: string, patch: Partial<VisualCanvasNode>, immediate = false) => {
      replaceNodes(
        (current) =>
          current.map((node) =>
            node.id === nodeId
              ? ({ ...node, ...patch } as VisualCanvasNode)
              : node,
          ),
        immediate,
      );
    },
    [replaceNodes],
  );
  const replaceEdges = useCallback(
    (
      updater:
        | VisualCanvasEdge[]
        | ((current: VisualCanvasEdge[]) => VisualCanvasEdge[]),
      immediate = false,
    ) => {
      setEdges((current) => {
        const next = typeof updater === "function" ? updater(current) : updater;
        edgesRef.current = next;
        if (autoSave.current) clearTimeout(autoSave.current);
        if (immediate) enqueueSave(nodesRef.current, next);
        else
          autoSave.current = setTimeout(
            () => enqueueSave(nodesRef.current, edgesRef.current),
            650,
          );
        return next;
      });
    },
    [enqueueSave],
  );

  return {
    revisionRef,
    nodesRef,
    edgesRef,
    conflictRef,
    saveFailureRef,
    autoSave,
    nodes,
    setNodes,
    edges,
    setEdges,
    saveState,
    setSaveState,
    saveMessage,
    setSaveMessage,
    conflict,
    setConflict,
    enqueueSave,
    prepareCanvasForAgent,
    replaceNodes,
    patchNode,
    replaceEdges,
  };
}
