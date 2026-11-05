import { LoadingState } from "@shared/ui/LoadingState";
import "./local-models.css";
import { useId, useState } from "react";
import { AudioLines, ChevronRight, Info, Monitor } from "lucide-react";
import type { Catalog } from "@features/models/api";
import { LocalModelDetails } from "./LocalModelDetails";
import {
  localModelConnection,
  localModelStatus,
} from "./localModelPresentation";
import { useLocalModels } from "./useLocalModels";
import type { ModelCatalogEditorProps } from "./catalogTypes";

export function LocalModelsPanel({
  catalog,
  canWrite,
  canTest = false,
  allowHostManagement = false,
  onTestModel,
  onOpenConnection,
}: {
  catalog: Catalog;
  canWrite: boolean;
  canTest?: boolean;
  allowHostManagement?: boolean;
  onTestModel?: ModelCatalogEditorProps["onTestModel"];
  onOpenConnection?: (providerId: string) => void;
}) {
  const { query, ...operations } = useLocalModels(catalog.revision);
  const [selectedId, setSelectedId] = useState("qwen3-tts-0.6b-base");
  const radioName = useId();
  const models = query.data?.items ?? [];
  const selected = models.find((model) => model.id === selectedId) ?? models[0];
  const connection = selected && localModelConnection(catalog, selected.id);

  return (
    <section className="local-models-panel" aria-label="本地模型">
      <div className="lm-notice">
        <Monitor size={17} aria-hidden />
        <span>
          Apple Silicon · macOS 15+
          <span className="lm-notice-divider"> · </span>录音与生成内容在本机处理
        </span>
      </div>
      {query.isError && (
        <div className="lm-feedback is-error" role="alert">
          <span>读取本地模型失败：{query.error.message}</span>
          <button
            className="btn"
            type="button"
            onClick={() => void query.refetch()}
          >
            重新读取
          </button>
        </div>
      )}
      {query.isPending ? (
        <LoadingState label="正在读取本地模型…" variant="region" />
      ) : !models.length && !query.isError ? (
        <div className="lm-empty">
          <AudioLines size={30} aria-hidden />
          <h2>暂无本地模型</h2>
          <p>当前没有可管理的模型，请稍后重新读取。</p>
          <button className="btn" onClick={() => void query.refetch()}>
            重新读取
          </button>
        </div>
      ) : (
        selected && (
          <div className="lm-workbench">
            <div className="lm-model-list">
              <fieldset>
                <legend>可安装模型</legend>
                {models.map((model) => (
                  <label
                    className={`lm-model-option${selected.id === model.id ? " is-selected" : ""}`}
                    key={model.id}
                  >
                    <input
                      type="radio"
                      name={radioName}
                      value={model.id}
                      checked={selected.id === model.id}
                      onChange={() => setSelectedId(model.id)}
                      aria-label={model.label}
                    />
                    <span className="lm-model-icon">
                      <AudioLines size={25} aria-hidden />
                    </span>
                    <span className="lm-model-copy">
                      <span className="lm-model-title">
                        <strong>{model.label}</strong>
                        {model.id === "qwen3-tts-0.6b-base" && (
                          <span className="lm-recommended">推荐先试</span>
                        )}
                      </span>
                      <span className="lm-model-meta">
                        下载 {(model.download_bytes / 1e9).toFixed(2)} GB ·
                        安装需 {(model.required_disk_bytes / 1e9).toFixed(1)} GB
                      </span>
                      <span
                        className={`lm-status${model.status === "installed" && model.enabled && model.compatible ? " is-ready" : ""}`}
                      >
                        {localModelStatus(model)}
                      </span>
                    </span>
                    <ChevronRight
                      size={17}
                      className="lm-option-chevron"
                      aria-hidden
                    />
                  </label>
                ))}
              </fieldset>
              <p className="lm-list-note">
                <Info size={16} aria-hidden />
                <span>
                  权重在本机共享，空间接入互相独立。安装空间包含环境与暂存。
                </span>
              </p>
            </div>
            <LocalModelDetails
              key={selected.id}
              model={selected}
              connection={connection}
              canManage={
                allowHostManagement && (query.data?.can_manage ?? false)
              }
              canWrite={canWrite}
              canTest={canTest}
              onTestModel={onTestModel}
              onOpenConnection={onOpenConnection}
              stale={query.isError}
              {...operations}
            />
          </div>
        )
      )}
      {operations.message && (
        <p className="lm-feedback is-success" role="status">
          {operations.message}
        </p>
      )}
      {operations.error && (
        <p className="lm-feedback is-error" role="alert">
          {operations.error}
        </p>
      )}
      {operations.refreshWarning && (
        <p className="lm-feedback" role="alert">
          {operations.refreshWarning}
        </p>
      )}
    </section>
  );
}
