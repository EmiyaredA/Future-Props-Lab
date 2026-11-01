import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  LockKeyhole,
  Play,
  RefreshCw,
  History,
  Info,
  FileText,
  Film,
  FileImage,
} from "lucide-react";
import { AcceptanceSchemePicker, SchemeIcon } from "./AcceptanceSchemePicker";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { fetchApiJson } from "@platform/api/client";
import { visualWorkshopQueryKeys as keys } from "../queryKeys";
import { base, type Run } from "./api";
import {
  acceptanceStateNames,
  getAcceptanceCatalog,
  getNodeAcceptance,
  selectAcceptanceScheme,
  startNodeAcceptance,
  type SchemeId,
} from "./nodeApi";
import { CheckScope } from "./CheckScope";
import { ReferenceMaterialRow } from "./ReferenceMaterialRow";
import { NodeRunReview } from "./NodeRunReview";
import "./acceptance.css";
import "./review.css";
import "./node-acceptance.css";
import "./node-panel.css";

export function NodeAcceptancePanel({
  projectId,
  nodeId,
  outputId,
  prepareCanvas,
  onGeneration,
  onTemplates,
  readOnly = false,
}: {
  projectId: string;
  nodeId: string;
  outputId?: string;
  prepareCanvas?: () => Promise<number>;
  onGeneration: () => void;
  onTemplates?: () => void;
  readOnly?: boolean;
}) {
  const client = useQueryClient();
  const permissionWrite = useAccountPermission("content.write");
  const canWrite = permissionWrite && !readOnly;
  const canUseModels = useAccountPermission("models.use");
  const canRun = canWrite && canUseModels;
  const [error, setError] = useState("");
  const [runId, setRunId] = useState<string>();
  const [history, setHistory] = useState(false);
  const [page, setPage] = useState(1);
  const [previous, setPrevious] = useState<Run>();
  const requestId = useRef<string | null>(null);
  const catalog = useQuery({
    queryKey: keys.acceptanceCatalog(),
    queryFn: getAcceptanceCatalog,
  });
  const context = useQuery({
    queryKey: keys.nodeAcceptance(projectId, nodeId, outputId),
    queryFn: () => getNodeAcceptance(projectId, nodeId, outputId),
    refetchInterval: (query) =>
      ["queued", "processing"].includes(
        query.state.data?.current_run?.status ?? "",
      )
        ? 1500
        : false,
  });
  const records = useQuery({
    queryKey: [...keys.acceptanceRuns(projectId, page), nodeId],
    queryFn: () =>
      fetchApiJson<{ items: Run[] }>(
        `${base(projectId)}/runs?node_id=${encodeURIComponent(nodeId)}&page=${page}`,
      ),
    enabled: history,
  });
  const schemes = catalog.data?.items[0]?.schemes ?? [];
  const value = context.data;
  const scheme = schemes.find((item) => item.id === value?.scheme_id);
  const selection = useMutation({
    mutationFn: async (scheme_id: SchemeId | null) => {
      if (prepareCanvas) await prepareCanvas();
      return selectAcceptanceScheme(projectId, nodeId, {
        expected_revision: value?.revision ?? 0,
        scheme_id,
      });
    },
    onSuccess: async () => {
      requestId.current = null;
      setPrevious(undefined);
      await context.refetch();
      await client.invalidateQueries({
        queryKey: keys.acceptanceSummary(projectId),
      });
    },
    onError: async (caught) => {
      setError(caught instanceof Error ? caught.message : "选择方案失败");
      await context.refetch();
    },
  });
  const start = useMutation({
    mutationFn: async () => {
      if (!value?.output_id) throw Error("当前节点暂无输出");
      if (prepareCanvas) await prepareCanvas();
      const fresh = await getNodeAcceptance(projectId, nodeId, value.output_id);
      if (
        fresh.context_fingerprint !== value.context_fingerprint ||
        fresh.revision !== value.revision
      ) {
        await context.refetch();
        throw Error("节点资料已变化，请核对更新后的验收依据再发起。");
      }
      requestId.current ??= crypto.randomUUID();
      return startNodeAcceptance(projectId, nodeId, {
        expected_revision: fresh.revision,
        expected_canvas_revision: fresh.canvas_revision,
        context_fingerprint: fresh.context_fingerprint,
        output_id: value.output_id,
        request_id: requestId.current,
        previous_run_id: previous?.id ?? null,
      });
    },
    onSuccess: async (result) => {
      requestId.current = null;
      setPrevious(undefined);
      setRunId(result.id);
      await context.refetch();
      await client.invalidateQueries({
        queryKey: keys.acceptanceSummary(projectId),
      });
    },
    onError: (caught) =>
      setError(caught instanceof Error ? caught.message : "发起验收失败"),
  });
  return (
    <section
      className="node-acceptance acceptance-workspace"
      aria-label="节点验收"
    >
      {error && (
        <p role="alert" className="acceptance-error">
          {error}
        </p>
      )}
      {runId ? (
        <NodeRunReview
          key={runId}
          projectId={projectId}
          runId={runId}
          writable={canWrite}
          prepareCanvas={prepareCanvas}
          onBack={() => {
            setRunId(undefined);
            void context.refetch();
          }}
          onRecheck={(run) => {
            setRunId(undefined);
            setPrevious(
              run.status === "failed" || run.status === "cancelled"
                ? undefined
                : run,
            );
            requestId.current = null;
            void context.refetch();
          }}
          onError={setError}
        />
      ) : (
        <div className="node-acceptance-setup">
          <div className="node-acceptance-heading">
            <div>
              <h2>
                验收当前版本{" "}
                <span className="acceptance-badge builtin">
                  输出{" "}
                  {value?.output_version ? `v${value.output_version}` : "—"} ·{" "}
                  {value?.current_run && value.result_is_current
                    ? (acceptanceStateNames[
                        value.current_run.status === "completed"
                          ? value.current_run.decision
                          : value.current_run.status
                      ] ?? "待确认")
                    : "尚未验收"}
                </span>
              </h2>
              <p>使用固定的验收方案，对当前节点输出进行质量检查。</p>
            </div>
            <button
              aria-label="刷新验收依据"
              onClick={() => {
                void context.refetch();
                void catalog.refetch();
              }}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          {(context.isError || catalog.isError) && (
            <p role="alert">
              验收信息读取失败。
              <button
                onClick={() => {
                  void context.refetch();
                  void catalog.refetch();
                }}
              >
                重新加载
              </button>
            </p>
          )}
          {context.isPending && <p role="status">正在读取节点验收依据…</p>}
          <div className="node-acceptance-scheme">
            <div className="node-acceptance-select-heading">
              <label className="node-acceptance-field">选择验收方案</label>
              {onTemplates && (
                <button onClick={onTemplates}>查看模板说明</button>
              )}
            </div>
            <AcceptanceSchemePicker
              schemes={schemes}
              value={value?.scheme_id}
              disabled={!canWrite || selection.isPending || !value}
              onChange={(identity) => {
                setError("");
                selection.mutate(identity);
              }}
            />
            {scheme && (
              <div className="node-fixed-connection">
                <SchemeIcon scheme={scheme} />
                <span>
                  <strong>{scheme.connection_label}</strong>
                  <small>{scheme.message}</small>
                </span>
                <span className="acceptance-badge neutral">
                  <LockKeyhole size={12} /> 固定接入
                </span>
              </div>
            )}
          </div>
          <div className="node-acceptance-inputs">
            <h3>
              已自动读取{" "}
              {value && !(value.issues?.length ?? 0) && (
                <span className="is-available">
                  <CheckCircle2 size={14} /> 资料已就绪
                </span>
              )}
            </h3>
            <p className="acceptance-muted">
              {value?.input_source === "generation_snapshot"
                ? "来自该输出生成时的资料快照"
                : "来自节点已保存的生成设置"}
            </p>
            <ul className="acceptance-reference-options">
              {value?.inputs?.map((item) => (
                <ReferenceMaterialRow
                  key={`${item.role}:${item.asset_id}`}
                  assetId={item.asset_id}
                  kind={item.kind}
                  title={item.label}
                  description=""
                >
                  <span className="node-acceptance-role">
                    {item.role === "character" ? (
                      <FileImage size={16} />
                    ) : (
                      <Film size={16} />
                    )}
                    {item.role === "character"
                      ? "角色基准图"
                      : item.role === "motion"
                        ? "原动作视频"
                        : "当前输出"}
                  </span>
                  <small className="node-acceptance-source">
                    {item.role === "output"
                      ? `当前节点输出 v${value.output_version}`
                      : item.role === "character"
                        ? "来自节点参考图片"
                        : "来自节点参考视频"}
                  </small>
                </ReferenceMaterialRow>
              ))}
            </ul>
            <dl>
              <dt>
                <Film size={16} />
                预期规格
              </dt>
              <dd>
                {value?.specifications?.ratio
                  ? String(value.specifications.ratio)
                  : "自适应画幅"}
                {value?.specifications?.min_width
                  ? ` · 至少 ${value.specifications.min_width} × ${value.specifications.min_height}`
                  : ""}
                {value?.specifications?.max_duration
                  ? ` · ${Number(value.specifications.max_duration) - 0.25} 秒`
                  : ""}
              </dd>
              <dt>
                <FileText size={16} />
                镜头要求
              </dt>
              <dd>{value?.prompt || "未提供额外镜头要求"}</dd>
            </dl>
          </div>
          {!!value?.issues?.length && (
            <div className="acceptance-notice">
              <ul>
                {value.issues?.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
              <button onClick={onGeneration}>
                {readOnly ? "返回项目" : "返回生成设置"}
              </button>
            </div>
          )}
          <div className="node-acceptance-scope">
            <div className="node-check-scope">
              <strong>本次将检查</strong>
              <CheckScope criteria={catalog.data?.items[0]?.criteria ?? []} />
            </div>
            {scheme && (
              <div className="node-return-scope">
                <strong>本方案返回</strong>
                <span>
                  <FileText size={19} />
                  {scheme.output_description}
                </span>
              </div>
            )}
            <p className="node-acceptance-info">
              <Info size={17} />
              所需信息已从节点整理，无需重复填写。验收不限制最终输出选择。
            </p>
          </div>
          {value?.current_run && (
            <div className="node-acceptance-latest">
              <strong>
                {value.result_is_current
                  ? "当前验收"
                  : "历史结果，当前依据需重新验收"}{" "}
                ·{" "}
                {acceptanceStateNames[value.current_run.decision] ??
                  value.current_run.status}
              </strong>
              <button onClick={() => setRunId(value.current_run!.id)}>
                查看验收结果
              </button>
            </div>
          )}
          {previous && (
            <p className="acceptance-notice">
              复验原输出 v{previous.snapshot.output.version}
              ；请选择右侧版本列表中的另一个输出后发起。
              <button onClick={() => setPrevious(undefined)}>取消复验</button>
            </p>
          )}
          <footer className="node-acceptance-footer">
            <button
              aria-expanded={history}
              onClick={() => setHistory(!history)}
            >
              <History size={16} />
              查看历史
            </button>
            <small>历史记录保留当时的模板、输入与结果。</small>
            <button
              className="acceptance-primary"
              disabled={
                !canRun ||
                start.isPending ||
                selection.isPending ||
                !value ||
                !!(value.issues?.length ?? 0) ||
                !scheme?.available ||
                ["queued", "processing"].includes(
                  value.current_run?.status ?? "",
                ) ||
                (!!previous && previous.output_id === value.output_id)
              }
              onClick={() => {
                setError("");
                start.mutate();
              }}
            >
              <Play size={16} />
              {start.isPending
                ? "正在提交…"
                : previous
                  ? `开始复验 v${value?.output_version ?? ""}`
                  : `开始验收 v${value?.output_version ?? ""}`}
            </button>
          </footer>
          {history && (
            <section className="node-acceptance-history">
              <h3>节点验收历史</h3>
              {records.data?.items.map((item) => (
                <button key={item.id} onClick={() => setRunId(item.id)}>
                  输出 v{item.snapshot.output.version} ·{" "}
                  {acceptanceStateNames[item.decision]} ·{" "}
                  {item.scheme_id === "legacy"
                    ? "旧版记录"
                    : schemes.find((s) => s.id === item.scheme_id)?.title}
                </button>
              ))}
              {records.isError && (
                <p role="alert">
                  历史读取失败。
                  <button onClick={() => void records.refetch()}>重试</button>
                </p>
              )}
              <div className="acceptance-actions">
                <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                  上一页
                </button>
                <button
                  disabled={(records.data?.items.length ?? 0) < 50}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </button>
              </div>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
