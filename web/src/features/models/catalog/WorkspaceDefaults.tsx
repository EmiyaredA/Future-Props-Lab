import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@platform/api/client";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { getCatalog, type Catalog } from "../api";
import { modelQueryKeys } from "../queryKeys";
import { CatalogDialog } from "./CatalogDialog";

const purposes = [
  ["chat", "对话"],
  ["image_generation", "图片生成"],
  ["video_generation", "视频生成"],
  ["voice", "实时语音"],
  ["speech_recognition", "语音识别"],
  ["audio_generation", "音频生成"],
] as const;

export function WorkspaceDefaults({
  catalog,
  canWrite,
}: {
  catalog: Catalog;
  canWrite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(catalog.default_model_ids || {});
  const [revision, setRevision] = useState(catalog.revision);
  const cache = useQueryClient();
  const save = async () => {
    try {
      const data = unwrap(
        await api.PUT("/v1/model-catalog/defaults", {
          body: { expected_revision: revision, default_model_ids: draft },
        }),
      );
      cache.setQueryData(modelQueryKeys.catalog, data);
      await cache.invalidateQueries({ queryKey: modelQueryKeys.catalog });
    } catch (cause) {
      void cache.invalidateQueries({ queryKey: modelQueryKeys.catalog });
      throw cause;
    }
  };
  return (
    <>
      <button
        className="btn"
        onClick={() => {
          setDraft(catalog.default_model_ids || {});
          setRevision(catalog.revision);
          setOpen(true);
        }}
      >
        默认模型用途
      </button>
      {open && (
        <CatalogDialog
          title="工作区默认模型"
          label="保存更改"
          hideSave={!canWrite}
          onClose={() => setOpen(false)}
          onSave={save}
          disabled={
            !canWrite ||
            JSON.stringify(draft) ===
              JSON.stringify(catalog.default_model_ids || {})
          }
          onRefresh={async () => {
            const latest = await cache.fetchQuery({
              queryKey: modelQueryKeys.catalog,
              queryFn: getCatalog,
              staleTime: 0,
            });
            setRevision(latest.revision);
          }}
        >
          <p className="mc-help">
            为新建模型测试选择初始模型，已有测试中的选择会保留。
          </p>
          {purposes.map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <CustomSelect
                ariaLabel={`${label}默认模型`}
                disabled={!canWrite}
                value={draft[key] || ""}
                options={[
                  { value: "", label: "未指定" },
                  ...catalog.providers
                    .filter((p) => p.enabled)
                    .flatMap((p) =>
                      p.models
                        .filter(
                          (m) => m.enabled && m.capabilities.includes(key),
                        )
                        .map((m) => ({
                          value: m.id,
                          label: `${p.name} / ${m.label || m.slug}`,
                        })),
                    ),
                ]}
                onChange={(value) => {
                  const next = { ...draft };
                  if (value) next[key] = value;
                  else delete next[key];
                  setDraft(next);
                }}
              />
            </label>
          ))}
        </CatalogDialog>
      )}
    </>
  );
}
