import { LoadingState } from "@shared/ui/LoadingState";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Clock3, RefreshCw } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import {
  getNodeOutputs,
  type VisualNodeOutput,
  type VisualCanvasNode,
} from "../api";
import { visualWorkshopQueryKeys as keys } from "../queryKeys";
import {
  createRuns,
  getModels,
  getRun,
  getRuns,
  type Run,
  type Repair,
  type Standard,
} from "./api";
import { RunReview } from "./RunReview";
import { AcceptanceNodePicker } from "./AcceptanceNodePicker";
import { AcceptanceModelPicker } from "./AcceptanceModelPicker";
export function RunsPane({
  projectId,
  nodes,
  standard,
  writable,
  busy,
  act,
  onRepair,
  onAdopt,
  onBack,
  onViewStandard,
  repairs,
  initialOutput,
}: {
  initialOutput?: VisualNodeOutput;
  projectId: string;
  nodes: VisualCanvasNode[];
  standard: Standard;
  writable: boolean;
  busy: boolean;
  act: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  onRepair: (run: Run) => Promise<void>;
  onAdopt: (run: Run) => Promise<void>;
  repairs: Readonly<Record<string, Repair>>;
  onBack: () => void;
  onViewStandard: () => void;
}) {
  const client = useQueryClient();
  const [nodeId, setNodeId] = useState(
    initialOutput?.node_id ?? nodes[0]?.id ?? "",
  );
  const [versionPage, setVersionPage] = useState(1),
    [recordPage, setRecordPage] = useState(1);
  const [picked, setPicked] = useState<string[]>(
      initialOutput ? [initialOutput.id] : [],
    ),
    [model, setModel] = useState("");
  const [selected, setSelected] = useState(""),
    [previous, setPrevious] = useState<Run>();
  const [choosing, setChoosing] = useState(true),
    [history, setHistory] = useState(false);
  const versions = useQuery({
    queryKey: keys.acceptanceOutputs(projectId, nodeId, versionPage),
    queryFn: () => getNodeOutputs(projectId, nodeId, versionPage),
    enabled: !!nodeId,
  });
  const models = useQuery({
    queryKey: keys.acceptanceModels(projectId),
    queryFn: () => getModels(projectId),
  });
  const records = useQuery({
    queryKey: keys.acceptanceRuns(projectId, recordPage),
    queryFn: () => getRuns(projectId, recordPage),
    refetchInterval: (query) =>
      query.state.data?.items.some((run) =>
        ["queued", "processing"].includes(run.status),
      )
        ? 1500
        : false,
  });
  const run = useQuery({
    queryKey: keys.acceptanceRun(projectId, selected),
    queryFn: () => getRun(projectId, selected),
    enabled: !!selected,
    refetchInterval: (query) =>
      ["queued", "processing"].includes(query.state.data?.status ?? "")
        ? 1500
        : false,
  });
  const needsModel =
    standard.published?.criteria?.some(
      (criterion) => criterion.method === "ai",
    ) ?? false;
  const openRun = (id: string) => {
    setSelected(id);
    setChoosing(false);
    setHistory(false);
  };
  const start = async () => {
    const response = await act(() =>
      createRuns(projectId, {
        request_id: crypto.randomUUID(),
        expected_standard_version: standard.published_version,
        output_ids: picked,
        model_id: model || null,
        previous_run_id: previous?.id ?? null,
      }),
    );
    if (response) {
      openRun(response.items[0].id);
      setPicked([]);
      setPrevious(undefined);
      await records.refetch();
    }
  };
  const update = (value: Run) => {
    client.setQueryData(keys.acceptanceRun(projectId, value.id), value);
    void client.invalidateQueries({ queryKey: keys.canvas(projectId) });
    void records.refetch();
    setSelected(value.id);
  };
  return (
    <>
      <div className="acceptance-record-toolbar">
        <strong>{selected ? "版本验收" : "开始验收"}</strong>
        <small>项目标准 v{standard.published_version}</small>
        <div className="acceptance-actions">
          <button
            aria-expanded={choosing}
            onClick={() => setChoosing(!choosing)}
          >
            <ChevronDown size={15} />
            {choosing ? "收起版本选择" : "切换输出版本"}
          </button>
          <button aria-expanded={history} onClick={() => setHistory(!history)}>
            <Clock3 size={15} />
            验收记录
          </button>
        </div>
      </div>
      <section
        hidden={!choosing}
        className="acceptance-surface acceptance-start"
      >
        <div className="acceptance-list-heading">
          <h2>{previous ? "选择返修版本复验" : "选择输出版本开始验收"}</h2>
          <button onClick={() => void versions.refetch()}>
            <RefreshCw size={14} />
            刷新版本列表
          </button>
        </div>
        <div className="acceptance-start-options">
          <AcceptanceNodePicker
            nodes={nodes}
            value={nodeId}
            onChange={(value) => {
              setNodeId(value);
              setVersionPage(1);
            }}
          />
          {needsModel && (
            <AcceptanceModelPicker
              value={model}
              onChange={setModel}
              models={models.data?.items ?? []}
            />
          )}
          <button
            disabled={
              !writable ||
              busy ||
              !standard.published_version ||
              !picked.length ||
              (needsModel &&
                (!model ||
                  !models.data?.items.some((item) => item.id === model)))
            }
            className="acceptance-primary"
            onClick={() => void start()}
          >
            {previous ? "开始复验" : "开始验收"}（{picked.length}）
          </button>
          {previous && (
            <button
              onClick={() => {
                setPrevious(undefined);
                setPicked([]);
              }}
            >
              取消复验选择
            </button>
          )}
        </div>
        {previous && (
          <p className="acceptance-muted">
            原记录输出 v{previous.snapshot.output.version}
            ，复验重新检查全部适用条目。
          </p>
        )}
        {!standard.published_version && (
          <p className="acceptance-notice">
            请先在“项目标准”发布一套验收标准。
          </p>
        )}
        {needsModel && models.data?.items.length === 0 && (
          <p className="acceptance-notice">
            暂无可用视觉模型，请先在模型服务启用 chat + vision
            模型。也可将条目改为人工确认后重新发布。
          </p>
        )}
        {(versions.error || models.error) && (
          <p role="alert" className="acceptance-error">
            数据加载失败。
            <button
              onClick={() => {
                void versions.refetch();
                void models.refetch();
              }}
            >
              重新加载
            </button>
          </p>
        )}
        <div className="acceptance-output-options">
          {versions.data?.items.map((output) => (
            <label key={output.id}>
              <input
                type="checkbox"
                disabled={
                  !writable ||
                  (!picked.includes(output.id) && picked.length >= 20) ||
                  (!!previous &&
                    (previous.node_id !== output.node_id ||
                      previous.output_id === output.id))
                }
                checked={picked.includes(output.id)}
                onChange={(event) =>
                  setPicked(
                    event.target.checked
                      ? previous
                        ? [output.id]
                        : [...picked, output.id]
                      : picked.filter((id) => id !== output.id),
                  )
                }
              />
              v{output.version} · {output.is_final ? "最终输出" : "候选版本"} ·{" "}
              {output.source === "generated" ? "生成" : "保存"}
            </label>
          ))}
        </div>
        <div className="acceptance-actions">
          <button
            disabled={versionPage === 1}
            onClick={() => setVersionPage((page) => page - 1)}
          >
            上一页版本
          </button>
          <button
            disabled={versionPage * 20 >= (versions.data?.total ?? 0)}
            onClick={() => setVersionPage((page) => page + 1)}
          >
            下一页版本
          </button>
          <small>每个输出独立记录；批量最多 20 个。</small>
        </div>
      </section>
      {history && (
        <section className="acceptance-surface acceptance-history-picker">
          <h3>验收记录</h3>
          <CustomSelect
            ariaLabel="验收记录"
            value={selected}
            onChange={openRun}
            options={[
              { value: "", label: "选择一条记录" },
              ...(records.data?.items.map((item) => ({
                value: item.id,
                label: `${item.snapshot.output.title} · v${item.snapshot.output.version} / 标准 v${item.standard_version}`,
              })) ?? []),
            ]}
          />
          <div className="acceptance-actions">
            <button
              disabled={recordPage === 1}
              onClick={() => setRecordPage((page) => page - 1)}
            >
              较新记录
            </button>
            <button
              disabled={(records.data?.items.length ?? 0) < 50}
              onClick={() => setRecordPage((page) => page + 1)}
            >
              较早记录
            </button>
          </div>
        </section>
      )}
      {records.error && (
        <p role="alert">
          记录列表加载失败。
          <button onClick={() => void records.refetch()}>重试</button>
        </p>
      )}
      {!records.data?.items.length && !selected && (
        <p className="acceptance-muted">
          暂无验收记录。先选择输出版本开始检查。
        </p>
      )}
      {run.isError && (
        <p role="alert">
          记录加载失败。<button onClick={() => void run.refetch()}>重试</button>
        </p>
      )}
      {selected && run.isPending && (
        <LoadingState label="正在加载验收记录…" variant="region" />
      )}
      {run.data && (
        <RunReview
          key={run.data.id}
          projectId={projectId}
          run={run.data}
          writable={writable}
          busy={busy}
          act={act}
          onUpdate={update}
          onRepair={onRepair}
          onAdopt={onAdopt}
          onOpenRun={openRun}
          onBack={onBack}
          onViewStandard={onViewStandard}
          repairs={repairs}
          onRecheck={(value) => {
            setPrevious(value);
            setChoosing(true);
            setNodeId(value.node_id);
            setVersionPage(1);
            setPicked([]);
            document
              .querySelector(".acceptance-start")
              ?.scrollIntoView({ behavior: "smooth" });
          }}
        />
      )}
    </>
  );
}
