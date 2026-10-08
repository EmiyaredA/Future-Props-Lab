import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@platform/api/client";
import {
  putVisualCanvas,
  type VisualCanvasDocument,
  type VisualCanvasEdge,
  type VisualCanvasNode,
} from "@features/visual-workshop/api";

type CanvasSnapshot = {
  nodes: VisualCanvasNode[];
  edges: VisualCanvasEdge[];
};

function snapshotSignature(snapshot: CanvasSnapshot) {
  return JSON.stringify(snapshot);
}

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
  const pendingSaves = useRef(0);
  const autoSave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const historyPast = useRef<CanvasSnapshot[]>([]);
  const historyFuture = useRef<CanvasSnapshot[]>([]);
  const initialized = useRef(false);
  const [nodes, setNodes] = useState<VisualCanvasNode[]>([]);
  const [edges, setEdges] = useState<VisualCanvasEdge[]>([]);
  const [saveState, setSaveState] = useState<
    "saved" | "saving" | "error" | "conflict"
  >("saved");
  const [saveMessage, setSaveMessage] = useState("");
  const [conflict, setConflict] = useState<VisualCanvasDocument>();

  const applyServerCanvas = useCallback((loaded: VisualCanvasDocument) => {
    const externalRevision =
      initialized.current && loaded.revision !== revisionRef.current;
    if (externalRevision && (autoSave.current || pendingSaves.current > 0)) {
      conflictRef.current = true;
      setConflict(loaded);
      setSaveState("conflict");
      return;
    }
    nodesRef.current = loaded.nodes;
    edgesRef.current = loaded.edges;
    revisionRef.current = loaded.revision;
    setNodes(loaded.nodes);
    setEdges(loaded.edges);
    if (!initialized.current || externalRevision) {
      historyPast.current = [];
      historyFuture.current = [];
    }
    initialized.current = true;
  }, []);
  useEffect(() => {
    if (loaded) applyServerCanvas(loaded);
  }, [loaded, applyServerCanvas]);
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
      pendingSaves.current += 1;
      saveQueue.current = saveQueue.current.then(async () => {
        if (conflictRef.current) {
          pendingSaves.current -= 1;
          return;
        }
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
          if (JSON.stringify(nodesRef.current) === JSON.stringify(nodeCopy)) {
            nodesRef.current = updated.nodes;
            setNodes(updated.nodes);
          }
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
        } finally {
          pendingSaves.current -= 1;
        }
      });
    },
    [projectId],
  );

  const recordHistory = useCallback((snapshot: CanvasSnapshot) => {
    const past = historyPast.current;
    const previous = past[past.length - 1];
    if (previous && snapshotSignature(previous) === snapshotSignature(snapshot))
      return;
    past.push(structuredClone(snapshot));
    if (past.length > 100) past.shift();
    historyFuture.current = [];
  }, []);

  const clearHistory = useCallback(() => {
    historyPast.current = [];
    historyFuture.current = [];
  }, []);

  const applyHistorySnapshot = useCallback(
    (snapshot: CanvasSnapshot) => {
      if (autoSave.current) {
        clearTimeout(autoSave.current);
        autoSave.current = undefined;
      }
      const nodesCopy = structuredClone(snapshot.nodes);
      const edgesCopy = structuredClone(snapshot.edges);
      nodesRef.current = nodesCopy;
      edgesRef.current = edgesCopy;
      setNodes(nodesCopy);
      setEdges(edgesCopy);
      enqueueSave(nodesCopy, edgesCopy);
    },
    [enqueueSave],
  );

  const undo = useCallback(() => {
    const target = historyPast.current.pop();
    if (!target) return false;
    historyFuture.current.push({
      nodes: structuredClone(nodesRef.current),
      edges: structuredClone(edgesRef.current),
    });
    applyHistorySnapshot(target);
    return true;
  }, [applyHistorySnapshot]);

  const redo = useCallback(() => {
    const target = historyFuture.current.pop();
    if (!target) return false;
    historyPast.current.push({
      nodes: structuredClone(nodesRef.current),
      edges: structuredClone(edgesRef.current),
    });
    applyHistorySnapshot(target);
    return true;
  }, [applyHistorySnapshot]);

  const prepareCanvasForAgent = useCallback(async () => {
    // Include saves scheduled while an earlier request is still in flight.
    for (;;) {
      if (autoSave.current) {
        clearTimeout(autoSave.current);
        autoSave.current = undefined;
        enqueueSave(nodesRef.current);
      }
      const queued = saveQueue.current;
      await queued;
      if (queued === saveQueue.current && !autoSave.current) break;
    }
    if (conflictRef.current)
      throw new Error("画布存在保存冲突，请先选择要使用的版本");
    if (saveFailureRef.current)
      throw new Error(`画布尚未保存：${saveFailureRef.current}`);
    return revisionRef.current;
  }, [enqueueSave]);

  const scheduleSave = useCallback(
    (immediate: boolean) => {
      if (autoSave.current) clearTimeout(autoSave.current);
      autoSave.current = undefined;
      if (immediate) enqueueSave(nodesRef.current, edgesRef.current);
      else {
        if (!conflictRef.current) setSaveState("saving");
        autoSave.current = setTimeout(() => {
          autoSave.current = undefined;
          enqueueSave(nodesRef.current, edgesRef.current);
        }, 650);
      }
    },
    [enqueueSave],
  );

  const replaceNodes = useCallback(
    (
      updater:
        | VisualCanvasNode[]
        | ((current: VisualCanvasNode[]) => VisualCanvasNode[]),
      immediate = false,
      trackHistory = true,
    ) => {
      const current = nodesRef.current;
      const next = typeof updater === "function" ? updater(current) : updater;
      if (next === current) {
        if (immediate) scheduleSave(true);
        return;
      }
      if (trackHistory) {
        recordHistory({ nodes: current, edges: edgesRef.current });
      }
      // Publish and queue the snapshot before returning to the submit handler.
      // React may defer or replay a state updater, so it cannot own save effects.
      nodesRef.current = next;
      setNodes(next);
      scheduleSave(immediate);
    },
    [recordHistory, scheduleSave],
  );
  const patchNode = useCallback(
    (nodeId: string, patch: Partial<VisualCanvasNode>, immediate = false) => {
      replaceNodes((current) => {
        let changed = false;
        const next = current.map((node) => {
          if (node.id !== nodeId) return node;
          const record = node as unknown as Record<string, unknown>;
          const unchanged = Object.entries(patch).every(
            ([key, value]) =>
              JSON.stringify(record[key]) === JSON.stringify(value),
          );
          if (unchanged) return node;
          changed = true;
          return { ...node, ...patch } as VisualCanvasNode;
        });
        return changed ? next : current;
      }, immediate);
    },
    [replaceNodes],
  );
  const replaceEdges = useCallback(
    (
      updater:
        | VisualCanvasEdge[]
        | ((current: VisualCanvasEdge[]) => VisualCanvasEdge[]),
      immediate = false,
      trackHistory = true,
    ) => {
      const current = edgesRef.current;
      const next = typeof updater === "function" ? updater(current) : updater;
      if (next === current) {
        if (immediate) scheduleSave(true);
        return;
      }
      if (trackHistory) {
        recordHistory({ nodes: nodesRef.current, edges: current });
      }
      edgesRef.current = next;
      setEdges(next);
      scheduleSave(immediate);
    },
    [recordHistory, scheduleSave],
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
    recordHistory,
    clearHistory,
    undo,
    redo,
    prepareCanvasForAgent,
    applyServerCanvas,
    replaceNodes,
    patchNode,
    replaceEdges,
  };
}
