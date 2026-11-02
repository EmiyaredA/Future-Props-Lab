import { LoadingState } from "@shared/ui/LoadingState";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { getVisualCanvas, selectNodeFinalOutput } from "../api";
import { visualWorkshopQueryKeys as keys } from "../queryKeys";
import { base, getRun, send, type Repair, type Run } from "./api";
import { RunReview } from "./RunReview";

export function NodeRunReview({
  projectId,
  runId,
  writable,
  prepareCanvas,
  onBack,
  onRecheck,
  onError,
}: {
  projectId: string;
  runId: string;
  writable: boolean;
  prepareCanvas?: () => Promise<number>;
  onBack: () => void;
  onRecheck: (run: Run) => void;
  onError: (message: string) => void;
}) {
  const client = useQueryClient();
  const [selected, setSelected] = useState(runId);
  const [busy, setBusy] = useState(false);
  const [repair, setRepair] = useState<Repair>();
  const [repairText, setRepairText] = useState("");
  const [repairs, setRepairs] = useState<Record<string, Repair>>({});
  const run = useQuery({
    queryKey: keys.acceptanceRun(projectId, selected),
    queryFn: () => getRun(projectId, selected),
    refetchInterval: (query) =>
      ["queued", "processing"].includes(query.state.data?.status ?? "")
        ? 1500
        : false,
  });
  const act = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    onError("");
    try {
      return await action();
    } catch (error) {
      onError(error instanceof Error ? error.message : "操作失败，请重试");
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const update = (value: Run) => {
    client.setQueryData(keys.acceptanceRun(projectId, value.id), value);
    void client.invalidateQueries({
      queryKey: keys.acceptanceSummary(projectId),
    });
    void client.invalidateQueries({
      queryKey: ["visual-node-acceptance", projectId],
    });
  };
  if (run.isPending)
    return <LoadingState label="正在读取验收记录…" variant="region" />;
  if (run.isError || !run.data)
    return (
      <p role="alert">
        验收记录加载失败。
        <button onClick={() => void run.refetch()}>重新加载</button>
      </p>
    );
  const historical =
    run.data.scheme_id === "legacy" || run.data.decision === "historical";
  return (
    <div className="acceptance-workspace node-acceptance-review">
      <button onClick={onBack}>返回节点验收</button>
      {historical && (
        <p className="acceptance-notice">
          历史验收记录只读，不影响最终输出选择。
        </p>
      )}
      {!!run.data.execution_result?.report && (
        <details open>
          <summary>Agent 验收报告</summary>
          <p>
            {String(
              (run.data.execution_result.report as { summary?: string })
                .summary ?? "",
            )}
          </p>
          <p>
            {(
              (run.data.execution_result.report as { limitations?: string[] })
                .limitations ?? []
            ).join("；")}
          </p>
        </details>
      )}
      <RunReview
        key={selected}
        projectId={projectId}
        run={run.data}
        writable={writable && !historical}
        busy={busy}
        act={act}
        repairs={repairs}
        onUpdate={update}
        onBack={onBack}
        onViewStandard={onBack}
        onOpenRun={setSelected}
        onRecheck={onRecheck}
        onAdopt={async (value) => {
          if (prepareCanvas) await prepareCanvas();
          const canvas = await getVisualCanvas(projectId);
          await selectNodeFinalOutput(
            projectId,
            value.node_id,
            value.output_id,
            canvas.revision,
          );
          await client.invalidateQueries({ queryKey: keys.canvas(projectId) });
        }}
        onRepair={async (value) => {
          const result = await act(() =>
            repairs[value.id]
              ? Promise.resolve(repairs[value.id])
              : send<Repair>(
                  `${base(projectId)}/runs/${value.id}/repair-drafts`,
                  {},
                ),
          );
          if (result) {
            setRepair(result);
            setRepairText(result.text);
            setRepairs((items) => ({ ...items, [value.id]: result }));
          }
        }}
      />
      {repair && (
        <ConfirmDialog
          open
          title="验收返修草稿"
          className="acceptance-repair-dialog"
          tone="primary"
          pending={busy}
          confirmLabel={
            repair.prompt_version_id
              ? "已保存为提示词版本"
              : "保存为新提示词版本"
          }
          confirmDisabled={!writable || !!repair.prompt_version_id}
          onCancel={() => setRepair(undefined)}
          onConfirm={async () => {
            const value = await act(async () => {
              if (prepareCanvas) await prepareCanvas();
              const canvas = await getVisualCanvas(projectId);
              return send<Repair>(
                `${base(projectId)}/repair-drafts/${repair.id}`,
                {
                  expected_revision: repair.revision,
                  text: repairText,
                  apply: true,
                  expected_canvas_revision: canvas.revision,
                },
                "PUT",
              );
            });
            if (value) {
              setRepair(value);
              setRepairs((items) => ({ ...items, [value.run_id]: value }));
              await client.invalidateQueries({
                queryKey: keys.canvas(projectId),
              });
            }
          }}
          description={
            <>
              <p>保存为提示词新版本后，返回生成设置手动提交生成。</p>
              <textarea
                aria-label="返修提示词"
                value={repairText}
                rows={10}
                maxLength={6000}
                disabled={!writable || !!repair.prompt_version_id}
                onChange={(event) => setRepairText(event.target.value)}
              />
            </>
          }
        />
      )}
    </div>
  );
}
