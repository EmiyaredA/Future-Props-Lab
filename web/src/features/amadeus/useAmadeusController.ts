import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAmadeusBridge } from "./PageContext";
import type { AccountSessionContext } from "@features/accounts";
import { decideAmadeusApproval } from "./approval";
import { submitAmadeusAnswer } from "./answerQuestion";
import { conversationActions } from "./conversationActions";
import { useAmadeusData } from "./useAmadeusData";
import { useAmadeusCapabilities } from "./useAmadeusCapabilities";
import { useAmadeusAttachments } from "./useAmadeusAttachments";
import { useAmadeusRun } from "./useAmadeusRun";
import { groupConversations } from "./conversationGroups";
import { useProjectSelection } from "./useProjectSelection";
import type {
  Approval,
  AvatarState,
  Conversation,
  Reference,
  SavedQuestion,
} from "./protocol";

export function useAmadeusController(
  session: AccountSessionContext,
  initialConversationId?: string,
  standalone = false,
) {
  const bridge = useAmadeusBridge();
  const owner = session.me.user.id;
  const [historyOpen, setHistoryOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [scriptOutput, setScriptOutput] = useState("");
  const [renameItem, setRenameItem] = useState<Conversation | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteItem, setDeleteItem] = useState<Conversation | null>(null);
  const [previewReference, setPreviewReference] = useState<Reference | null>(
    null,
  );
  const [avatarState, setAvatarState] = useState<AvatarState>("idle");
  const activeActionRef = useRef<{
    conversationId: string;
    actionId: string;
  } | null>(null);
  const avatarTimerRef = useRef<number | undefined>(undefined);
  const isExecutingAction = useCallback(
    (id: string) => activeActionRef.current?.actionId === id,
    [],
  );
  const onPickFinished = useCallback(() => {
    setAvatarState((current) => (current === "listening" ? "idle" : current));
  }, []);
  useEffect(() => () => window.clearTimeout(avatarTimerRef.current), [owner]);

  const showAvatarState = useCallback(
    (state: AvatarState, resetAfter?: number) => {
      if (avatarTimerRef.current) window.clearTimeout(avatarTimerRef.current);
      setAvatarState(state);
      if (resetAfter) {
        avatarTimerRef.current = window.setTimeout(() => {
          setAvatarState("idle");
          avatarTimerRef.current = undefined;
        }, resetAfter);
      }
    },
    [],
  );

  const data = useAmadeusData({
    owner,
    initialConversationId,
    standalone,
    bridge,
    isExecutingAction,
    onPickFinished,
    onError: setError,
  });
  const {
    conversations,
    detail,
    runs,
    contexts,
    getDetail,
    open,
    refreshList,
    captureSelection,
    updateDetail,
    setDraft,
  } = data;
  const capabilities = useAmadeusCapabilities(
    owner,
    detail?.conversation,
    runs,
    setError,
  );
  const attachments = useAmadeusAttachments(
    owner,
    data,
    capabilities.keepModelSelection,
    setError,
  );
  const scopedContexts = contexts.filter(
    (item) => item.userId === owner && item.accountId === owner,
  );
  const conversationId = detail?.conversation.id;
  const { projects, setProjects } = useProjectSelection({
    owner,
    conversationId,
    pageContexts: scopedContexts,
    lastRunContexts:
      runs.filter(({ run }) => run.conversation_id === conversationId).at(-1)
        ?.run.context ?? [],
    standalone,
  });

  const { busy, isBusy, setMode, send, ...run } = useAmadeusRun({
    owner,
    conversations: data,
    capabilities,
    projects,
    scopedContexts,
    isImporting: attachments.isImporting,
    setError,
    showAvatarState,
  });
  const { create, pinMessage, forkMessage, rename, remove } =
    conversationActions({
      getDetail,
      captureSelection,
      busy,
      refreshList,
      open,
      clearSelection: data.clearSelection,
      updateDetail,
      setError,
      setRenameItem,
      setDeleteItem,
    });

  const startFromHistory = async () => {
    const previous = getDetail();
    const context =
      previous?.messages
        .slice(-8)
        .map((message) => `${message.role}: ${message.content.slice(0, 3000)}`)
        .join("\n\n") || "";
    const id = await create();
    if (!id || getDetail()?.conversation.id !== id) return;
    setDraft(
      `以下是我选择带入的历史参考，请先核对当前项目状态，再根据我的新要求继续。\n\n${context}\n\n新要求：`,
    );
  };

  const continueRun = async (
    sourceRunId: string,
    nextMode: "agent" | "plan",
    prompt: string,
    feedback?: string,
  ) => {
    const id = getDetail()?.conversation.id;
    if (!id || busy) return;
    setMode(nextMode);
    const isCurrent = captureSelection();
    const history = await open(id);
    const source = history?.find((item) => item.run.id === sourceRunId)?.run;
    const resolvedInteraction =
      source &&
      ["waiting_approval", "waiting_question"].includes(source.status);
    if (
      resolvedInteraction &&
      history?.some((item) => item.run.source_run_id === sourceRunId)
    )
      return;
    if (isCurrent() && getDetail()?.conversation.id === id)
      await send({ sourceRunId, mode: nextMode, prompt, feedback });
  };

  const reviseArtifact = async (
    sourceRunId: string,
    kind: "plan" | "draft",
    content: string,
    note: string,
  ) => {
    const label = kind === "plan" ? "计划" : "草稿";
    const feedback = `请根据我修订的${label}重新思考并交付新版本。\n\n[我的修订]\n${content}\n\n[补充说明]\n${note || "无"}`;
    if (feedback.length > 90_000)
      throw new Error("修订内容过长，请缩短后重试。");
    await continueRun(
      sourceRunId,
      kind === "plan" ? "plan" : "agent",
      feedback,
      feedback,
    );
  };

  const reviseApproval = async (
    actionId: string,
    arguments_: Record<string, unknown>,
    note: string,
  ) => {
    const saved = getDetail()?.actions.find((item) => item.id === actionId);
    if (!saved || !saved.run_id || saved.status !== "pending" || busy)
      throw new Error("这份审批已不可修订，请刷新对话。");
    const feedback = `旧提案已撤回。请重新读取目标及最新版本，参考我修订的完整参数重新拟案；不要直接执行。\n\n[参数草案]\n${JSON.stringify(arguments_, null, 2)}\n\n[补充说明]\n${note || "无"}`;
    if (feedback.length > 90_000)
      throw new Error("修订参数过长，请缩短后重试。");
    const current: Approval = {
      id: saved.id,
      tool_name: saved.tool_name,
      arguments: saved.arguments,
      arguments_sha256: saved.arguments_sha256,
      status: saved.status,
      conversationId: getDetail()!.conversation.id,
      runId: saved.run_id,
    };
    const isCurrent = captureSelection();
    const withdrawn = await decideAmadeusApproval({
      allow: false,
      current,
      contexts,
      session,
      bridge,
      activeActionRef,
      isCurrent,
      signal: data.selectionSignal(),
      acceptDetail: (snapshot) => updateDetail(isCurrent, () => snapshot),
      setError,
      setScriptOutput,
    });
    if (!withdrawn) throw new Error("撤回旧审批失败");
    if (!isCurrent()) return;
    await continueRun(saved.run_id, "agent", feedback, feedback);
  };

  const decideApproval = async (actionId: string, allow: boolean) => {
    const saved = getDetail()?.actions.find((item) => item.id === actionId);
    if (!saved || !saved.run_id) return;
    const current: Approval = {
      id: saved.id,
      tool_name: saved.tool_name,
      arguments: saved.arguments,
      arguments_sha256: saved.arguments_sha256,
      status: saved.status,
      conversationId: getDetail()!.conversation.id,
      runId: saved.run_id,
    };
    const isCurrent = captureSelection();
    const handled = await decideAmadeusApproval({
      allow,
      current,
      contexts,
      session,
      bridge,
      activeActionRef,
      isCurrent,
      signal: data.selectionSignal(),
      acceptDetail: (snapshot) => updateDetail(isCurrent, () => snapshot),
      setError,
      setScriptOutput,
    });
    if (handled && isCurrent())
      await continueRun(
        current.runId,
        "agent",
        allow
          ? "根据刚才已批准的工具结果继续，先核对当前项目状态。"
          : "刚才的操作被拒绝。继续说明可行的下一步，不再执行该操作。",
      );
  };

  const answerQuestion = async (
    question: SavedQuestion,
    answer: string,
    note: string,
  ) => {
    const id = getDetail()?.conversation.id;
    if (!id || busy) return;
    const isCurrent = captureSelection();
    await submitAmadeusAnswer(id, question, answer, note);
    if (!isCurrent()) return;
    await continueRun(
      question.run_id,
      runs.find((item) => item.run.id === question.run_id)?.run.mode || "agent",
      "用户已经回答提问。根据已保存的答案继续。",
    );
  };

  const groups = useMemo(
    () => groupConversations(conversations, search, renameItem?.id),
    [conversations, search, renameItem?.id],
  );

  return {
    ...capabilities,
    ...attachments,
    ...run,
    bridge,
    detail,
    runs,
    draft: data.draft,
    setDraft,
    references: data.references,
    setReferences: data.setReferences,
    loaded: data.loaded,
    setLoaded: data.setLoaded,
    historyOpen,
    setHistoryOpen,
    search,
    setSearch,
    setMode,
    busy,
    saving: false,
    error,
    setError,
    scriptOutput,
    renameItem,
    setRenameItem,
    renameTitle,
    setRenameTitle,
    deleteItem,
    setDeleteItem,
    previewReference,
    setPreviewReference,
    avatarState,
    showAvatarState,
    open,
    decideApproval,
    reviseApproval,
    reviseArtifact,
    answerQuestion,
    continueRun,
    create,
    pinMessage,
    forkMessage,
    rename,
    remove,
    importAttachments: (files: File[]) =>
      attachments.importAttachments(files, isBusy),
    send,
    startFromHistory,
    scopedContexts,
    projects,
    setProjects,
    groups,
  };
}
