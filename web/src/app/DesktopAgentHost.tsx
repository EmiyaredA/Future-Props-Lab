import { useQueryClient } from "@tanstack/react-query";
import { integrationKeys } from "@features/integrations/queryKeys";
import type { OpenDetail } from "@features/integrations/interaction";
import { useEffect, useRef, useState } from "react";
import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";
import "@platform/desktop";
import { useStudioSession } from "./StudioSession";
import { pathFor, type AppPage } from "./routes";
import "./desktop-agent.css";

type Pairing = components["schemas"]["AgentPairOut"];
type OpenRequest = components["schemas"]["DesktopOpenOut"];
const pages: Record<OpenRequest["kind"], AppPage> = {
  visual: "visual-workshop-canvas",
  galgame: "galgame-workshop-editor",
  video: "video-editor-editor",
  presentation: "presentation-workshop-editor",
  annotation: "audio-annotation-editor",
  director: "director-desk-editor",
  note: "thought-workshop-legacy",
  knowledge: "thought-workshop-editor",
  skill: "integrations-skills",
  "tool-api": "integrations-tool-apis",
  mcp: "integrations-mcp",
};

export function DesktopAgentHost() {
  const { me } = useStudioSession();
  const queryClient = useQueryClient();
  const [pairs, setPairs] = useState<Pairing[]>([]);
  const [opening, setOpening] = useState<OpenRequest | null>(null);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const processed = useRef(new Set<string>());
  const cancelled = useRef(new Set<string>());
  const revision = useRef<number | null>(null);
  const activeOpen = useRef<string | null>(null);

  useEffect(() => {
    if (!window.futurePropsDesktop?.agentStatus) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    revision.current = null;
    activeOpen.current = null;
    processed.current.clear();
    cancelled.current.clear();
    setOpening(null);
    setPairs([]);
    setChanged(false);
    let destination: OpenDetail | null = null;
    let integrationRevisions: Record<string, number> | null = null;
    const ack = async (
      item: OpenRequest,
      status: "waiting_confirmation" | "opened" | "cancelled" | "unavailable",
    ) => {
      if (!active || cancelled.current.has(item.id)) return;
      await unwrap(
        await api.POST("/v1/desktop/ui/requests/{request_id}/ack", {
          params: { path: { request_id: item.id } },
          body: { status },
        }),
      );
      if (active && (status === "opened" || status === "unavailable")) {
        destination = null;
        activeOpen.current = null;
        setOpening(null);
      }
    };
    const poll = async () => {
      try {
        const status = await window.futurePropsDesktop!.agentStatus();
        if (status.enabled) {
          const [pairings, messages] = await Promise.all([
            api.GET("/v1/desktop/agent/pairings").then(unwrap),
            api.GET("/v1/desktop/ui/inbox").then(unwrap),
          ]);
          if (!active) return;
          setPairs(pairings);
          if (
            revision.current !== null &&
            revision.current !==
              (messages.content_change_revision ?? messages.change_revision)
          )
            setChanged(true);
          revision.current =
            messages.content_change_revision ?? messages.change_revision;
          const nextRevisions = messages.integration_revisions ?? {};
          const changedKinds = Object.keys(nextRevisions).filter(
            (kind) =>
              integrationRevisions !== null &&
              nextRevisions[kind] !== (integrationRevisions[kind] ?? 0),
          );
          integrationRevisions = nextRevisions;
          if (changedKinds.length) {
            if (window.location.pathname.startsWith("/integrations"))
              window.dispatchEvent(
                new CustomEvent("future-props:integration-change", {
                  detail: changedKinds,
                }),
              );
            else
              changedKinds.forEach((kind) => {
                void queryClient.invalidateQueries({
                  queryKey: integrationKeys.catalog(kind),
                });
              });
          }
          if (destination?.active())
            window.dispatchEvent(
              new CustomEvent("future-props:integration-open", {
                detail: destination,
              }),
            );
          if (activeOpen.current) {
            const id = activeOpen.current;
            const result = await api.GET(
              "/v1/desktop/ui/requests/{request_id}",
              {
                params: { path: { request_id: id } },
              },
            );
            if (!active) return;
            if (result.error || result.data?.status === "unavailable") {
              cancelled.current.add(id);
              activeOpen.current = null;
              setOpening(null);
              setError("打开请求已过期或不可用，请让 Agent 重新发起");
            }
          }
          for (const item of messages.requests) {
            if (activeOpen.current) break;
            if (processed.current.has(item.id)) continue;
            processed.current.add(item.id);
            activeOpen.current = item.id;
            await ack(item, "waiting_confirmation");
            if (!active) return;
            setOpening(item);
            const target =
              item.kind === "note"
                ? pathFor(pages.note, undefined, item.resource_id ?? undefined)
                : pathFor(pages[item.kind], item.resource_id ?? undefined);
            window.dispatchEvent(
              new CustomEvent("future-props:agent-open", {
                detail: {
                  path: target,
                  active: () => active && !cancelled.current.has(item.id),
                  opened: () => {
                    if (["skill", "tool-api", "mcp"].includes(item.kind)) {
                      destination = {
                        request: item,
                        active: () =>
                          active &&
                          activeOpen.current === item.id &&
                          !cancelled.current.has(item.id),
                        complete: (ok) => {
                          void ack(item, ok ? "opened" : "unavailable").catch(
                            () => setError("无法确认界面打开结果"),
                          );
                          if (!ok)
                            setError("集成目标已不存在、权限不足或加载失败");
                        },
                      };
                      window.dispatchEvent(
                        new CustomEvent("future-props:integration-open", {
                          detail: destination,
                        }),
                      );
                    } else
                      void ack(item, "opened").catch(() =>
                        setError("无法确认界面打开结果"),
                      );
                  },
                },
              }),
            );
            break; // Serialize navigation; never stack unsaved-change prompts.
          }
        } else if (active) {
          setPairs([]);
        }
      } catch {
        /* Session transitions and stopped backends are handled by the app shell. */
      } finally {
        if (active) timer = setTimeout(() => void poll(), 1500);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [me.user.id, queryClient]);

  if (!pairs.length && !opening && !changed && !error) return null;
  const pair = pairs[0];
  return (
    <aside
      className="desktop-agent-notice"
      aria-label="本地 Agent 接入通知"
      aria-live="polite"
    >
      {pair && (
        <section>
          <h3>允许「{pair.name}」接入？</h3>
          <p>
            核对码 <strong className="desktop-agent-code">{pair.code}</strong> ·
            当前账号：{me.user.display_name}
          </p>
          <p>
            {pair.scope === "studio:write"
              ? "此授权允许修改和删除作品、管理集成，并可调用模型产生费用。集成校验可能发出真实请求或启动白名单服务。不会逐次询问。"
              : "此授权只能读取当前账号的作品和素材。"}{" "}
            有效期 90 天，可在 API 密钥页撤销。
          </p>
          <div className="desktop-agent-actions">
            {[false, true].map((approve) => (
              <button
                type="button"
                key={String(approve)}
                className={`btn ${approve ? "primary" : ""}`}
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError("");
                  void api
                    .POST("/v1/desktop/agent/pairings/{pair_id}/decision", {
                      params: { path: { pair_id: pair.id } },
                      body: {
                        approve,
                        code: pair.code,
                        expected_owner_user_id: me.user.id,
                      },
                    })
                    .then(unwrap)
                    .then(() =>
                      setPairs((items) =>
                        items.filter((item) => item.id !== pair.id),
                      ),
                    )
                    .catch(() =>
                      setError("授权处理失败，请检查当前权限或重新发起连接"),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                {approve ? "核对一致，允许接入" : "拒绝"}
              </button>
            ))}
          </div>
        </section>
      )}
      {opening && (
        <section>
          <p>Agent 请求打开页面。如有未保存内容，请先处理编辑器中的提示。</p>
          <button
            className="btn"
            onClick={() => {
              const item = opening;
              activeOpen.current = null;
              cancelled.current.add(item.id);
              setOpening(null);
              void api
                .POST("/v1/desktop/ui/requests/{request_id}/ack", {
                  params: { path: { request_id: item.id } },
                  body: { status: "cancelled" },
                })
                .then(unwrap)
                .catch(() => setError("打开请求已失效"));
            }}
          >
            取消本次打开
          </button>
        </section>
      )}
      {changed && (
        <section>
          <p>Agent 已更新账号内容。刷新前会检查尚未保存的编辑。</p>
          <button
            className="btn"
            onClick={() => {
              const refresh = () => window.location.reload();
              const event = new CustomEvent("future-props:before-navigation", {
                cancelable: true,
                detail: refresh,
              });
              if (window.dispatchEvent(event)) refresh();
            }}
          >
            查看更新
          </button>
        </section>
      )}
      {error && (
        <p role="alert">
          {error}
          <button className="btn small" onClick={() => setError("")}>
            关闭提示
          </button>
        </p>
      )}
    </aside>
  );
}
