import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
export function RunsPane({
  projectId,
  nodes,
  standard,
  writable,
  busy,
  act,
  onRepair,
  onAdopt,
  initialOutput,
}: {
  initialOutput?: VisualNodeOutput;
  projectId: string;
  nodes: VisualCanvasNode[];
  standard: Standard;
  writable: boolean;
  busy: boolean;
  act: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  onRepair: (draft: Repair) => void;
  onAdopt: (run: Run) => Promise<void>;
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
  const [choosing, setChoosing] = useState(true);
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
    refetchInterval: (q) =>
      q.state.data?.items.some((r) =>
        ["queued", "processing"].includes(r.status),
      )
        ? 1500
        : false,
  });
  const run = useQuery({
    queryKey: keys.acceptanceRun(projectId, selected),
    queryFn: () => getRun(projectId, selected),
    enabled: !!selected,
    refetchInterval: (q) =>
      ["queued", "processing"].includes(q.state.data?.status ?? "")
        ? 1500
        : false,
  });
  const publishedCriteria = standard.published?.criteria ?? [];
  const needsModel = publishedCriteria.some((c) => c.method === "ai");
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
      setSelected(response.items[0].id);
      setPicked([]);
      setPrevious(undefined);
      setChoosing(false);
      await records.refetch();
    }
  };
  const update = (value: Run) => {
    client.setQueryData(keys.acceptanceRun(projectId, value.id), value);
    void records.refetch();
    setSelected(value.id);
  };
  return (
    <>
      <section className="acceptance-surface acceptance-start">
        <div className="acceptance-start-heading">
          <h2>{previous ? "选择返修版本复验" : "选择输出版本开始验收"}</h2>
          <button
            onClick={() => setChoosing(!choosing)}
            aria-expanded={choosing}
          >
            {choosing ? "收起版本选择" : "选择其他输出"}
          </button>
        </div>
        <div hidden={!choosing}>
          <p className="acceptance-muted">
            标准 v{standard.published_version} · 每个输出独立留存结果。
            {previous &&
              ` 原记录 ${previous.id.slice(0, 8)}，重新检查全部条目。`}
          </p>
          <div className="acceptance-actions">
            <CustomSelect
              ariaLabel="验收节点"
              value={nodeId}
              onChange={(value) => {
                setNodeId(value);
                setVersionPage(1);
              }}
              options={nodes.map((node) => ({
                value: node.id,
                label: node.title,
              }))}
            />
            {needsModel && (
              <CustomSelect
                ariaLabel="验收视觉模型"
                value={model}
                onChange={setModel}
                options={[
                  { value: "", label: "请选择视觉模型" },
                  ...(models.data?.items.map((m) => ({
                    value: m.id,
                    label: `${m.provider_name} · ${m.label}`,
                  })) ?? []),
                ]}
              />
            )}
            <button
              disabled={
                !writable ||
                busy ||
                !standard.published_version ||
                !picked.length ||
                (needsModel && !model)
              }
              className="acceptance-primary"
              onClick={() => void start()}
            >
              {previous ? "开始复验" : "开始验收"}（{picked.length}）
            </button>
            {previous && (
              <button onClick={() => setPrevious(undefined)}>
                取消复验选择
              </button>
            )}
          </div>
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
          {(versions.error || models.error || records.error) && (
            <p role="alert">数据加载失败，请刷新后重试。</p>
          )}
          <button onClick={() => void versions.refetch()}>刷新版本列表</button>
          <div className="acceptance-output-options">
            {versions.data?.items.map((output) => (
              <label key={output.id}>
                <input
                  type="checkbox"
                  disabled={
                    !writable ||
                    (!!previous &&
                      (previous.node_id !== output.node_id ||
                        previous.output_id === output.id))
                  }
                  checked={picked.includes(output.id)}
                  onChange={(e) =>
                    setPicked(
                      e.target.checked
                        ? previous
                          ? [output.id]
                          : [...picked, output.id]
                        : picked.filter((id) => id !== output.id),
                    )
                  }
                />{" "}
                v{output.version} · {output.is_final ? "最终输出" : "候选版本"}{" "}
                · {output.source === "generated" ? "生成" : "保存"}
              </label>
            ))}
          </div>
          <div className="acceptance-actions">
            <button
              disabled={versionPage === 1}
              onClick={() => setVersionPage((p) => p - 1)}
            >
              上一页版本
            </button>
            <button
              disabled={versionPage * 20 >= (versions.data?.total ?? 0)}
              onClick={() => setVersionPage((p) => p + 1)}
            >
              下一页版本
            </button>
            <small>可切换节点，批量选择最多 20 个输出。</small>
          </div>
        </div>
      </section>
      <div className="acceptance-record-navigation">
        <h2>验收记录</h2>
        <CustomSelect
          ariaLabel="验收记录"
          value={selected}
          onChange={setSelected}
          options={[
            { value: "", label: "选择一条记录" },
            ...(records.data?.items.map((r) => ({
              value: r.id,
              label: `${r.snapshot.output.title} · v${r.snapshot.output.version} / 标准 v${r.standard_version}`,
            })) ?? []),
          ]}
        />
        <button
          disabled={recordPage === 1}
          onClick={() => setRecordPage((p) => p - 1)}
        >
          较新记录
        </button>
        <button
          disabled={(records.data?.items.length ?? 0) < 50}
          onClick={() => setRecordPage((p) => p + 1)}
        >
          较早记录
        </button>
      </div>
      {!records.data?.items.length && (
        <p className="acceptance-muted">
          暂无验收记录。先选择输出版本开始检查。
        </p>
      )}
      {run.isError && <p role="alert">记录加载失败。</p>}
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
