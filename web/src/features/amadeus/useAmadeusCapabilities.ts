import { useCallback, useEffect, useRef, useState } from "react";
import { getAgents, type Agent as AgentOption } from "@features/code-agents";
import { fetchApiJson } from "@platform/api/client";
import type {
  Capability,
  Conversation,
  ModelOption,
  NamedOption,
  RunDetail,
} from "./protocol";

export function useAmadeusCapabilities(
  owner: string,
  conversation: Conversation | undefined,
  runs: RunDetail[],
  setError: (message: string) => void,
) {
  const [modelId, setModelId] = useState("default");
  const [reasoningEffort, setReasoningEffort] = useState("");
  const [modelVariant, setModelVariant] = useState("");
  const [harnessEffort, setHarnessEffort] = useState("");
  const [fast, setFast] = useState(false);
  const [harnessCatalog, setHarnessCatalog] = useState<{
    model: string;
    options?: NamedOption[];
  } | null>(null);
  const [agentId, setAgentId] = useState("codex");
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const [toolApis, setToolApis] = useState<Capability[]>([]);
  const [mcpServers, setMcpServers] = useState<Capability[]>([]);
  const [skills, setSkills] = useState<Capability[]>([]);
  const [registeredOperations, setRegisteredOperations] = useState(0);
  const capabilitiesRequest = useRef<AbortController | undefined>(undefined);
  const refreshCapabilities = useCallback(async () => {
    capabilitiesRequest.current?.abort();
    const request = new AbortController();
    capabilitiesRequest.current = request;
    const init = { signal: request.signal };
    try {
      const [apis, mcps, skillList] = await Promise.all([
        fetchApiJson<{ items: Capability[] }>(
          "/v1/integrations/tool-apis",
          init,
        ),
        fetchApiJson<{ items: Capability[] }>("/v1/integrations/mcp", init),
        fetchApiJson<{ items: Capability[] }>("/v1/integrations/skills", init),
      ]);
      if (request.signal.aborted) return;
      setToolApis(apis.items);
      setMcpServers(mcps.items);
      setSkills(skillList.items);
      const business = await fetchApiJson<{ items: unknown[] }>(
        "/v1/amadeus/operations",
        init,
      );
      if (!request.signal.aborted)
        setRegisteredOperations(business.items.length);
    } catch (cause) {
      if (!request.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [setError]);
  useEffect(() => {
    void refreshCapabilities();
    return () => capabilitiesRequest.current?.abort();
  }, [owner, refreshCapabilities]);
  const openCapabilities = async () => {
    setCapabilitiesOpen(!capabilitiesOpen);
    if (!capabilitiesOpen) await refreshCapabilities();
  };
  useEffect(() => {
    let request: AbortController | undefined;
    setAgents([]);
    const refresh = () => {
      request?.abort();
      const current = new AbortController();
      request = current;
      void getAgents({ signal: current.signal })
        .then((value) => {
          if (!current.signal.aborted) setAgents(value.items);
        })
        .catch((cause) => {
          if (!current.signal.aborted) setError(String(cause));
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      request?.abort();
      window.removeEventListener("focus", refresh);
    };
  }, [owner, setError]);
  const selectedAgent = agents.find((item) => item.id === agentId);
  const models: ModelOption[] = [
    { id: "default", label: "CLI 默认模型" },
    ...(selectedAgent?.models || []),
  ];
  if (!models.some((item) => item.id === modelId))
    models.push({ id: modelId, label: `${modelId} · 上次使用` });
  const selectedModel = models.find((item) => item.id === modelId);
  const reasoningEfforts = selectedModel?.reasoning_efforts ?? [];
  const modelVariants = selectedModel?.variants ?? [];
  const fastAvailable = selectedModel?.fast_available === true;
  const harnessModel =
    agentId === "dsh" && modelId !== "default" ? modelId : null;
  const currentHarnessCatalog =
    harnessCatalog?.model === harnessModel ? harnessCatalog : null;
  const harnessEfforts = currentHarnessCatalog?.options ?? [];
  const harnessCatalogStatus = !harnessModel
    ? null
    : !currentHarnessCatalog
      ? "loading"
      : currentHarnessCatalog.options
        ? "available"
        : "unavailable";
  useEffect(() => {
    setHarnessCatalog(null);
    if (!harnessModel) return;
    let latestRequest: AbortController | undefined;
    const refresh = () => {
      latestRequest?.abort();
      const request = new AbortController();
      latestRequest = request;
      void fetchApiJson<{ items: AgentOption[] }>(
        `/v1/code-agents?harness_model=${encodeURIComponent(harnessModel)}`,
        { signal: request.signal },
      )
        .then(({ items }) => {
          if (request.signal.aborted) return;
          const harness = items.find((item) => item.id === "dsh");
          setHarnessCatalog({
            model: harnessModel,
            options:
              harness?.harness_options_model === harnessModel
                ? (harness.harness_efforts ?? [])
                : undefined,
          });
        })
        .catch(() => {
          if (!request.signal.aborted)
            setHarnessCatalog({ model: harnessModel });
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      latestRequest?.abort();
      window.removeEventListener("focus", refresh);
    };
  }, [harnessModel, owner]);
  const effectiveReasoningEffort = reasoningEfforts.includes(reasoningEffort)
    ? reasoningEffort
    : "";
  const selectedConversationRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!conversation || selectedConversationRef.current === conversation.id)
      return;
    selectedConversationRef.current = conversation.id;
    if (conversation.agent_id) {
      setAgentId(conversation.agent_id);
    }
    const latest = runs
      .filter((item) => item.run.conversation_id === conversation.id)
      .at(-1)?.run;
    setModelId(latest?.agent_model || "default");
    setReasoningEffort(latest?.reasoning_effort || "");
    setModelVariant(latest?.model_variant || "");
    setHarnessEffort(latest?.harness_effort || "");
    setFast(latest?.service_tier === "fast");
  }, [conversation, runs]);

  const keepModelSelection = (conversationId: string) => {
    selectedConversationRef.current = conversationId;
  };
  return {
    agents,
    agentId,
    setAgentId,
    models,
    modelCatalog: selectedAgent?.model_catalog,
    modelId,
    modelVariants,
    modelVariant,
    setModelVariant,
    harnessEfforts,
    harnessEffort,
    harnessCatalogStatus,
    setHarnessEffort,
    fast,
    fastAvailable,
    setFast,
    reasoningEfforts,
    reasoningEffort: effectiveReasoningEffort,
    setReasoningEffort,
    keepModelSelection,
    setModelId: (value: string) => {
      setModelId(value);
      setReasoningEffort("");
      setModelVariant("");
      setHarnessEffort("");
      setFast(false);
    },
    capabilitiesOpen,
    setCapabilitiesOpen,
    openCapabilities,
    toolApis,
    mcpServers,
    skills,
    scriptAvailable: false,
    registeredOperations,
  };
}
