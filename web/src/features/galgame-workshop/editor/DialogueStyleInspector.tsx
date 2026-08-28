import { useRef, useState, type CSSProperties } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FolderOpen,
  ImagePlus,
  MessageSquareText,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import {
  DIALOGUE_BOX_PRESETS,
  dialogueBoxPresetStyle,
  resolveDialogueBoxStyle,
  uploadGalgameProjectAsset,
  type GalgameStoryDialogueBoxStyle,
  type GalgameStoryProject,
  type GalgameStoryStageStyle,
  type GalgameStoryUiComponent,
} from "@features/galgame-workshop/api";
import { DialogueFontScaleField } from "@features/galgame-workshop/editor/DialogueFontScaleField";
import {
  DEFAULT_DIALOGUE_BOX_STYLE,
  DEFAULT_STAGE_STYLE,
  DEFAULT_UI_STYLE,
  stableId,
} from "@features/galgame-workshop/editor/model";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import {
  StoryImagePicker,
  type StoryImagePickerState,
} from "@features/galgame-workshop/editor/StoryImagePicker";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { invalidateGalgameAssetQueries } from "@features/galgame-workshop/queryKeys";

const PRESETS: Array<{
  id: Exclude<GalgameStoryDialogueBoxStyle["preset"], "custom">;
  label: string;
}> = [
  { id: "dark", label: "暗夜" },
  { id: "light", label: "雾白" },
  { id: "accent", label: "珊瑚" },
  { id: "classicGradient", label: "经典渐隐" },
];

type AssetTarget =
  { kind: "dialogueBox" } | { kind: "uiComponent"; componentId: string };

const VISIBILITY_OPTIONS: Array<{
  value: GalgameStoryUiComponent["visibility"];
  label: string;
}> = [
  { value: "always", label: "始终显示" },
  { value: "content", label: "剧情播放时" },
  { value: "dialogue", label: "对白与旁白时" },
  { value: "choices", label: "分支选择时" },
];

const rangeProgress = (value: number, min: number, max: number) =>
  ({
    "--range-progress": `${((value - min) / (max - min)) * 100}%`,
  }) as CSSProperties;

type PickerContext = {
  target: AssetTarget;
  label: string;
  state: StoryImagePickerState;
};

export function DialogueStyleInspector({
  projectId,
  document,
  onDocument,
}: {
  projectId: string;
  document: GalgameStoryProject;
  onDocument: (document: GalgameStoryProject) => void;
}) {
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [picker, setPicker] = useState<PickerContext>();
  const [uploadTarget, setUploadTarget] = useState<AssetTarget>();
  const [uploadError, setUploadError] = useState("");
  const style = resolveDialogueBoxStyle(
    document.presentation?.dialogueBox ?? DEFAULT_DIALOGUE_BOX_STYLE,
  );
  const uiStyle = {
    ...DEFAULT_UI_STYLE,
    ...document.presentation?.ui,
  };
  const stageStyle = {
    ...DEFAULT_STAGE_STYLE,
    ...document.presentation?.stage,
  };
  const dialogueAsset = (document.assets ?? []).find(
    (asset) => asset.id === style.assetId,
  );
  const usedFileIds = new Set(
    (document.assets ?? []).map((asset) => asset.fileId),
  );

  const updateStyle = (next: Partial<GalgameStoryDialogueBoxStyle>) => {
    onDocument({
      ...document,
      presentation: {
        ...document.presentation,
        dialogueBox: { ...style, ...next },
      },
    });
  };

  const updateLayout = (
    next: Partial<NonNullable<GalgameStoryDialogueBoxStyle["layout"]>>,
  ) => updateStyle({ preset: "custom", layout: { ...style.layout, ...next } });
  const updateBackground = (
    next: Partial<NonNullable<GalgameStoryDialogueBoxStyle["background"]>>,
  ) =>
    updateStyle({
      preset: "custom",
      background: { ...style.background, ...next },
    });
  const updateBody = (
    next: Partial<NonNullable<GalgameStoryDialogueBoxStyle["body"]>>,
  ) => updateStyle({ preset: "custom", body: { ...style.body, ...next } });
  const updateSpeakerName = (
    next: Partial<NonNullable<GalgameStoryDialogueBoxStyle["speakerName"]>>,
  ) =>
    updateStyle({
      preset: "custom",
      speakerName: { ...style.speakerName, ...next },
    });
  const updateAdvanceIndicator = (
    next: Partial<
      NonNullable<GalgameStoryDialogueBoxStyle["advanceIndicator"]>
    >,
  ) =>
    updateStyle({
      preset: "custom",
      advanceIndicator: { ...style.advanceIndicator, ...next },
    });

  const applyPreset = (
    preset: Exclude<GalgameStoryDialogueBoxStyle["preset"], "custom">,
  ) =>
    onDocument({
      ...document,
      presentation: {
        ...document.presentation,
        dialogueBox: dialogueBoxPresetStyle(preset),
      },
    });

  const updateStageStyle = (next: Partial<GalgameStoryStageStyle>) => {
    onDocument({
      ...document,
      presentation: {
        ...document.presentation,
        stage: { ...stageStyle, ...next },
      },
    });
  };

  const components = uiStyle.components ?? [];
  const componentById = (componentId: string) =>
    components.find((component) => component.id === componentId);
  const assetIdForTarget = (target: AssetTarget) =>
    target.kind === "dialogueBox"
      ? style.assetId
      : componentById(target.componentId)?.assetId;
  const selectedAssetForTarget = (target: AssetTarget) =>
    (document.assets ?? []).find(
      (asset) => asset.id === assetIdForTarget(target),
    );

  const updateComponents = (next: GalgameStoryUiComponent[]) => {
    onDocument({
      ...document,
      presentation: {
        ...document.presentation,
        dialogueBox: style,
        ui: { components: next },
      },
    });
  };

  const updateComponent = (
    componentId: string,
    next: Partial<GalgameStoryUiComponent>,
  ) =>
    updateComponents(
      components.map((component) =>
        component.id === componentId ? { ...component, ...next } : component,
      ),
    );

  const presentationWithAsset = (
    target: AssetTarget,
    assetId: string | null,
  ) =>
    target.kind === "dialogueBox"
      ? {
          ...document.presentation,
          dialogueBox: { ...style, assetId },
          ui: uiStyle,
        }
      : {
          ...document.presentation,
          dialogueBox: style,
          ui: {
            components: components.map((component) =>
              component.id === target.componentId
                ? { ...component, assetId }
                : component,
            ),
          },
        };

  const bindFile = (target: AssetTarget, fileId: string) => {
    const selectedAsset = selectedAssetForTarget(target);
    const assetId = selectedAsset?.id ?? stableId();
    onDocument({
      ...document,
      assets: selectedAsset
        ? (document.assets ?? []).map((asset) =>
            asset.id === selectedAsset.id ? { ...asset, fileId } : asset,
          )
        : [
            ...(document.assets ?? []),
            {
              id: assetId,
              type: "image",
              role:
                target.kind === "dialogueBox" ? "dialogueBox" : "uiComponent",
              fileId,
              status: "ready",
            },
          ],
      presentation: presentationWithAsset(target, assetId),
    });
    setPicker(undefined);
    setUploadTarget(undefined);
  };

  const upload = useMutation({
    mutationFn: ({ file }: { file: File; target: AssetTarget }) =>
      uploadGalgameProjectAsset(projectId, file),
    onSuccess: (asset, variables) => {
      setUploadError("");
      void invalidateGalgameAssetQueries(client, projectId);
      bindFile(variables.target, asset.id);
    },
    onError: (caught) =>
      setUploadError(caught instanceof Error ? caught.message : "图片上传失败"),
  });

  const targetLabel = (target: AssetTarget) =>
    target.kind === "dialogueBox"
      ? "对话框底图"
      : componentById(target.componentId)?.name || "界面组件";

  const openUpload = (target: AssetTarget) => {
    const selectedAsset = selectedAssetForTarget(target);
    const label = targetLabel(target);
    setUploadTarget(target);
    setPicker({
      target,
      label,
      state: {
        mode: selectedAsset ? "replace" : "add",
        source: "project",
      },
    });
    requestAnimationFrame(() => fileInput.current?.click());
  };

  const openLibrary = (target: AssetTarget) => {
    const selectedAsset = selectedAssetForTarget(target);
    const label = targetLabel(target);
    setPicker({
      target,
      label,
      state: {
        mode: selectedAsset ? "replace" : "add",
        source: "library",
      },
    });
  };

  const removeImage = (target: AssetTarget) => {
    const selectedAsset = selectedAssetForTarget(target);
    if (!selectedAsset) return;
    const usedByAnotherComponent =
      target.kind === "uiComponent" &&
      components.some(
        (component) =>
          component.id !== target.componentId &&
          component.assetId === selectedAsset.id,
      );
    onDocument({
      ...document,
      assets: usedByAnotherComponent
        ? document.assets
        : (document.assets ?? []).filter(
            (asset) => asset.id !== selectedAsset.id,
          ),
      presentation: presentationWithAsset(target, null),
    });
  };

  const addComponent = () => {
    const count = components.length + 1;
    updateComponents([
      ...components,
      {
        id: stableId(),
        name: `界面组件 ${count}`,
        assetId: null,
        x: 4,
        y: 4,
        width: 24,
        visibility: "always",
        layer: 1,
      },
    ]);
  };

  const removeComponent = (componentId: string) => {
    const component = componentById(componentId);
    const assetUsedElsewhere = components.some(
      (candidate) =>
        candidate.id !== componentId &&
        candidate.assetId === component?.assetId,
    );
    onDocument({
      ...document,
      assets:
        component?.assetId && !assetUsedElsewhere
          ? (document.assets ?? []).filter(
              (asset) => asset.id !== component.assetId,
            )
          : document.assets,
      presentation: {
        ...document.presentation,
        dialogueBox: style,
        ui: {
          components: components.filter(
            (candidate) => candidate.id !== componentId,
          ),
        },
      },
    });
  };

  const resetStyle = () => {
    onDocument({
      ...document,
      assets: dialogueAsset
        ? (document.assets ?? []).filter(
            (asset) => asset.id !== dialogueAsset.id,
          )
        : document.assets,
      presentation: {
        ...document.presentation,
        dialogueBox: dialogueBoxPresetStyle("dark"),
        ui: uiStyle,
      },
    });
  };

  return (
    <section className="galgame-dialogue-style-inspector">
      <header>
        <span>
          <MessageSquareText aria-hidden />
        </span>
        <div>
          <strong>对话框外观</strong>
          <small>所有对白与旁白共用这套样式</small>
        </div>
      </header>

      <div className="galgame-dialogue-style-section galgame-stage-style-section">
        <label className="galgame-stage-checkbox">
          <input
            type="checkbox"
            checked={stageStyle.speakerFocusEnabled}
            onChange={(event) =>
              updateStageStyle({ speakerFocusEnabled: event.target.checked })
            }
          />
          <span>多人同屏时自动突出当前说话者</span>
        </label>
        <label className="galgame-stage-checkbox">
          <input
            type="checkbox"
            checked={stageStyle.lipSyncEnabled}
            onChange={(event) =>
              updateStageStyle({ lipSyncEnabled: event.target.checked })
            }
          />
          <span>使用配套闭口、半口和张口帧驱动口型</span>
        </label>
        <label className="galgame-stage-range">
          <span>
            非说话者亮度
            <em>{Math.round(stageStyle.inactiveBrightness * 100)}%</em>
          </span>
          <input
            aria-label="非说话者亮度"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={stageStyle.inactiveBrightness}
            style={rangeProgress(stageStyle.inactiveBrightness, 0, 1)}
            onChange={(event) =>
              updateStageStyle({
                inactiveBrightness: Number(event.target.value),
              })
            }
          />
        </label>
        <label className="galgame-stage-range">
          <span>
            聚焦切换时长 <em>{stageStyle.focusTransitionMs}ms</em>
          </span>
          <input
            aria-label="聚焦切换时长"
            type="range"
            min="0"
            max="5000"
            step="50"
            value={stageStyle.focusTransitionMs}
            style={rangeProgress(stageStyle.focusTransitionMs, 0, 5000)}
            onChange={(event) =>
              updateStageStyle({
                focusTransitionMs: Number(event.target.value),
              })
            }
          />
        </label>
      </div>

      <div className="galgame-dialogue-style-section">
        <label>样式预设</label>
        <div className="galgame-dialogue-presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={style.preset === preset.id ? "active" : ""}
              onClick={() => applyPreset(preset.id)}
            >
              <span
                style={{
                  background:
                    preset.id === "classicGradient"
                      ? `linear-gradient(180deg, transparent, ${DIALOGUE_BOX_PRESETS[preset.id].backgroundColor})`
                      : DIALOGUE_BOX_PRESETS[preset.id].backgroundColor,
                  color: DIALOGUE_BOX_PRESETS[preset.id].textColor,
                }}
              >
                Aa
              </span>
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="galgame-dialogue-style-section">
        <label>对话框底图</label>
        <div className="galgame-dialogue-skin-preview">
          <StoryAssetImage
            fileId={dialogueAsset?.fileId}
            alt=""
            fallback={<ImagePlus aria-hidden />}
          />
          <span>
            <strong>
              {dialogueAsset ? "已绑定自定义底图" : "使用纯色底板"}
            </strong>
            <small>推荐透明 PNG，画幅接近 4:1</small>
          </span>
        </div>
        <div className="galgame-dialogue-skin-actions">
          <button
            type="button"
            onClick={() => openUpload({ kind: "dialogueBox" })}
          >
            <Upload aria-hidden /> {dialogueAsset ? "替换底图" : "上传底图"}
          </button>
          <button
            type="button"
            onClick={() => openLibrary({ kind: "dialogueBox" })}
          >
            <FolderOpen aria-hidden /> 从文件库选择
          </button>
          {dialogueAsset ? (
            <button
              type="button"
              className="danger"
              onClick={() => removeImage({ kind: "dialogueBox" })}
            >
              <Trash2 aria-hidden /> 移除
            </button>
          ) : null}
        </div>
        {uploadError ? (
          <p className="galgame-dialogue-style-error">{uploadError}</p>
        ) : null}
      </div>

      <div className="galgame-dialogue-style-section">
        <div className="galgame-interface-skin-heading">
          <div>
            <label>自定义 Gal 组件</label>
            <p className="galgame-interface-skin-help">
              自由添加 HUD、装饰、按钮图或提示图，并设置显示时机、位置与尺寸。
            </p>
          </div>
          <button type="button" onClick={addComponent}>
            <Plus aria-hidden /> 添加组件
          </button>
        </div>
        <div className="galgame-interface-skin-grid">
          {components.map((component, index) => {
            const target: AssetTarget = {
              kind: "uiComponent",
              componentId: component.id,
            };
            const selectedAsset = selectedAssetForTarget(target);
            return (
              <article
                key={component.id}
                className="galgame-interface-skin-card"
              >
                <div className="galgame-interface-skin-preview">
                  <StoryAssetImage
                    fileId={selectedAsset?.fileId}
                    alt=""
                    fallback={<ImagePlus aria-hidden />}
                  />
                </div>
                <div className="galgame-interface-skin-copy">
                  <input
                    aria-label={`组件 ${index + 1} 名称`}
                    value={component.name}
                    onChange={(event) =>
                      updateComponent(component.id, {
                        name: event.target.value,
                      })
                    }
                  />
                  <small>透明 PNG、JPG、WebP 或 AVIF</small>
                </div>
                <div className="galgame-interface-skin-actions">
                  <button
                    type="button"
                    aria-label={`${selectedAsset ? "替换" : "上传"}${component.name}`}
                    onClick={() => openUpload(target)}
                  >
                    <Upload aria-hidden /> {selectedAsset ? "替换" : "上传"}
                  </button>
                  <button
                    type="button"
                    aria-label={`从文件库选择${component.name}`}
                    onClick={() => openLibrary(target)}
                  >
                    <FolderOpen aria-hidden /> 文件库
                  </button>
                  {selectedAsset ? (
                    <button
                      type="button"
                      className="danger"
                      aria-label={`移除${component.name}图片`}
                      onClick={() => removeImage(target)}
                    >
                      <Trash2 aria-hidden />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="danger"
                    aria-label={`删除${component.name}组件`}
                    onClick={() => removeComponent(component.id)}
                  >
                    删除组件
                  </button>
                </div>
                <div className="galgame-interface-component-settings">
                  <label>
                    <span>显示时机</span>
                    <CustomSelect
                      ariaLabel={`${component.name}显示时机`}
                      value={component.visibility}
                      onChange={(value) =>
                        updateComponent(component.id, {
                          visibility:
                            value as GalgameStoryUiComponent["visibility"],
                        })
                      }
                      options={VISIBILITY_OPTIONS}
                    />
                  </label>
                  <label>
                    <span>层级</span>
                    <input
                      type="number"
                      aria-label={`${component.name}层级`}
                      min="0"
                      max="20"
                      value={component.layer}
                      onChange={(event) =>
                        updateComponent(component.id, {
                          layer: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  {(
                    [
                      ["横向位置", "x", component.x, 0, 100],
                      ["纵向位置", "y", component.y, 0, 100],
                      ["组件宽度", "width", component.width, 1, 100],
                    ] as const
                  ).map(([label, key, value, min, max]) => (
                    <label key={key} className="range">
                      <span>
                        {label} <strong>{Math.round(value)}%</strong>
                      </span>
                      <input
                        type="range"
                        aria-label={`${component.name}${label}`}
                        min={min}
                        max={max}
                        value={value}
                        onChange={(event) =>
                          updateComponent(component.id, {
                            [key]: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              </article>
            );
          })}
          {components.length === 0 ? (
            <button
              type="button"
              className="galgame-interface-skin-empty"
              onClick={addComponent}
            >
              <ImagePlus aria-hidden />
              <strong>添加第一个界面组件</strong>
              <span>名称和用途都由项目自己定义</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="galgame-dialogue-color-grid">
        <label>
          <span>底板颜色</span>
          <CustomColorPicker
            ariaLabel="对话框底板颜色"
            value={style.backgroundColor}
            onChange={(value) =>
              updateStyle({
                preset: "custom",
                backgroundColor: value,
              })
            }
          />
        </label>
        <label>
          <span>正文颜色</span>
          <CustomColorPicker
            ariaLabel="对话框正文颜色"
            value={style.textColor}
            onChange={(value) =>
              updateStyle({
                preset: "custom",
                textColor: value,
              })
            }
          />
        </label>
        <label>
          <span>角色名颜色</span>
          <CustomColorPicker
            ariaLabel="对话框角色名颜色"
            value={style.nameColor}
            onChange={(value) =>
              updateStyle({
                preset: "custom",
                nameColor: value,
              })
            }
          />
        </label>
      </div>

      <label className="galgame-dialogue-range">
        <span>
          底板整体透明度{" "}
          <strong>{Math.round(style.backgroundOpacity * 100)}%</strong>
        </span>
        <input
          type="range"
          aria-label="对话框底板整体透明度"
          min="20"
          max="100"
          value={Math.round(style.backgroundOpacity * 100)}
          style={rangeProgress(
            Math.round(style.backgroundOpacity * 100),
            20,
            100,
          )}
          onChange={(event) =>
            updateStyle({
              preset: "custom",
              backgroundOpacity: Number(event.target.value) / 100,
            })
          }
        />
      </label>
      <label className="galgame-dialogue-range">
        <span>
          圆角 <strong>{style.borderRadius}px</strong>
        </span>
        <input
          type="range"
          aria-label="对话框圆角"
          min="0"
          max="32"
          value={style.borderRadius}
          style={rangeProgress(style.borderRadius, 0, 32)}
          onChange={(event) =>
            updateStyle({
              preset: "custom",
              borderRadius: Number(event.target.value),
            })
          }
        />
      </label>
      <DialogueFontScaleField
        style={style}
        onScaleChange={(fontScale) =>
          updateStyle({ preset: "custom", fontScale })
        }
        onBodyFontSizeChange={(fontSizePx) => updateBody({ fontSizePx })}
        onNameFontSizeChange={(fontSizePx) => updateSpeakerName({ fontSizePx })}
      />

      <details className="galgame-dialogue-advanced-settings">
        <summary>高级布局与排版</summary>
        <div className="galgame-dialogue-advanced-grid">
          <label>
            <span>对话框布局</span>
            <CustomSelect
              ariaLabel="对话框布局"
              value={style.layout.mode}
              onChange={(value) =>
                updateLayout({
                  mode: value as typeof style.layout.mode,
                })
              }
              options={[
                { value: "boxed", label: "底部面板" },
                { value: "bottomOverlay", label: "底部渐隐覆盖" },
              ]}
            />
          </label>
          <label>
            <span>背景方式</span>
            <CustomSelect
              ariaLabel="对话框背景方式"
              value={style.background.mode}
              onChange={(value) =>
                updateBackground({
                  mode: value as typeof style.background.mode,
                })
              }
              options={[
                { value: "solid", label: "纯色" },
                { value: "verticalGradient", label: "纵向渐变" },
              ]}
            />
          </label>
          <label>
            <span>正文对齐</span>
            <CustomSelect
              ariaLabel="对话框正文对齐"
              value={style.body.align}
              onChange={(value) =>
                updateBody({ align: value as typeof style.body.align })
              }
              options={[
                { value: "left", label: "左对齐" },
                { value: "center", label: "居中" },
                { value: "right", label: "右对齐" },
              ]}
            />
          </label>
          <label>
            <span>人物名位置</span>
            <CustomSelect
              ariaLabel="对话框人物名位置"
              value={style.speakerName.placement}
              onChange={(value) =>
                updateSpeakerName({
                  placement: value as typeof style.speakerName.placement,
                })
              }
              options={[
                { value: "topLeft", label: "左上" },
                { value: "topCenter", label: "上方居中" },
                { value: "bottomLeft", label: "左下" },
                { value: "bottomCenter", label: "下方居中" },
                { value: "hidden", label: "隐藏" },
              ]}
            />
          </label>
          <label>
            <span>姓名装饰</span>
            <CustomSelect
              ariaLabel="对话框姓名装饰"
              value={style.speakerName.decoration}
              onChange={(value) =>
                updateSpeakerName({
                  decoration: value as typeof style.speakerName.decoration,
                })
              }
              options={[
                { value: "none", label: "无" },
                { value: "sideLines", label: "两侧细线" },
              ]}
            />
          </label>
          <label>
            <span>顶部边线</span>
            <CustomSelect
              ariaLabel="对话框顶部边线"
              value={style.background.topRule}
              onChange={(value) =>
                updateBackground({
                  topRule: value as typeof style.background.topRule,
                })
              }
              options={[
                { value: "none", label: "无" },
                { value: "single", label: "单线" },
                { value: "double", label: "双线" },
              ]}
            />
          </label>
          <label>
            <span>状态提示位置</span>
            <CustomSelect
              ariaLabel="对话框状态提示位置"
              value={style.advanceIndicator.position}
              onChange={(value) =>
                updateAdvanceIndicator({
                  position: value as typeof style.advanceIndicator.position,
                })
              }
              options={[
                { value: "topLeft", label: "左上" },
                { value: "topRight", label: "右上" },
                { value: "bottomLeft", label: "左下" },
                { value: "bottomRight", label: "右下" },
              ]}
            />
          </label>
          <label>
            <span>状态提示样式</span>
            <CustomSelect
              ariaLabel="对话框状态提示样式"
              value={style.advanceIndicator.style}
              onChange={(value) =>
                updateAdvanceIndicator({
                  style: value as typeof style.advanceIndicator.style,
                })
              }
              options={[
                { value: "descriptive", label: "说明文字" },
                { value: "compact", label: "紧凑状态" },
              ]}
            />
          </label>
        </div>

        {(
          [
            [
              "对话框宽度",
              style.layout.widthPercent,
              40,
              100,
              updateLayout,
              "widthPercent",
            ],
            [
              "对话框高度",
              style.layout.heightPercent,
              12,
              50,
              updateLayout,
              "heightPercent",
            ],
            [
              "底部偏移",
              style.layout.bottomOffsetPercent,
              0,
              30,
              updateLayout,
              "bottomOffsetPercent",
            ],
            [
              "左右安全边距",
              style.layout.contentInsetXPercent,
              0,
              25,
              updateLayout,
              "contentInsetXPercent",
            ],
            [
              "正文顶部位置",
              style.layout.contentInsetTopPercent,
              0,
              40,
              updateLayout,
              "contentInsetTopPercent",
            ],
            [
              "姓名底部位置",
              style.layout.contentInsetBottomPercent,
              0,
              30,
              updateLayout,
              "contentInsetBottomPercent",
            ],
            [
              "正文最大宽度",
              style.body.maxWidthPercent,
              30,
              100,
              updateBody,
              "maxWidthPercent",
            ],
          ] as const
        ).map(([label, value, min, max, update, key]) => (
          <label key={key} className="galgame-dialogue-range">
            <span>
              {label} <strong>{Math.round(value)}%</strong>
            </span>
            <input
              type="range"
              aria-label={`对话框${label}`}
              min={min}
              max={max}
              value={value}
              style={rangeProgress(value, min, max)}
              onChange={(event) =>
                update({ [key]: Number(event.target.value) })
              }
            />
          </label>
        ))}
        <label className="galgame-dialogue-range">
          <span>
            正文行高 <strong>{style.body.lineHeight.toFixed(2)}</strong>
          </span>
          <input
            type="range"
            aria-label="对话框正文行高"
            min="1"
            max="2.5"
            step="0.05"
            value={style.body.lineHeight}
            style={rangeProgress(style.body.lineHeight, 1, 2.5)}
            onChange={(event) =>
              updateBody({ lineHeight: Number(event.target.value) })
            }
          />
        </label>
        {style.background.mode === "verticalGradient" ? (
          <>
            <label className="galgame-dialogue-range">
              <span>
                渐变顶部节点透明度{" "}
                <strong>
                  {Math.round(style.background.gradientTopOpacity * 100)}%
                </strong>
              </span>
              <input
                type="range"
                aria-label="对话框渐变顶部节点透明度"
                min="0"
                max="100"
                value={Math.round(style.background.gradientTopOpacity * 100)}
                style={rangeProgress(
                  Math.round(style.background.gradientTopOpacity * 100),
                  0,
                  100,
                )}
                onChange={(event) =>
                  updateBackground({
                    gradientTopOpacity: Number(event.target.value) / 100,
                  })
                }
              />
            </label>
            <label className="galgame-dialogue-range">
              <span>
                渐变底部节点透明度{" "}
                <strong>
                  {Math.round(style.background.gradientBottomOpacity * 100)}%
                </strong>
              </span>
              <input
                type="range"
                aria-label="对话框渐变底部节点透明度"
                min="0"
                max="100"
                value={Math.round(style.background.gradientBottomOpacity * 100)}
                style={rangeProgress(
                  Math.round(style.background.gradientBottomOpacity * 100),
                  0,
                  100,
                )}
                onChange={(event) =>
                  updateBackground({
                    gradientBottomOpacity: Number(event.target.value) / 100,
                  })
                }
              />
            </label>
          </>
        ) : null}
        <div className="galgame-dialogue-advanced-checks">
          <label>
            <input
              type="checkbox"
              checked={style.advanceIndicator.visible}
              onChange={(event) =>
                updateAdvanceIndicator({ visible: event.target.checked })
              }
            />
            <span>显示推进状态</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={style.advanceIndicator.showInExport}
              onChange={(event) =>
                updateAdvanceIndicator({
                  showInExport: event.target.checked,
                })
              }
            />
            <span>视频导出中保留状态</span>
          </label>
        </div>
      </details>

      <button
        type="button"
        className="galgame-dialogue-style-reset"
        onClick={resetStyle}
      >
        <RotateCcw aria-hidden /> 恢复默认样式
      </button>

      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        aria-label="上传项目界面素材文件"
        accept="image/png,image/jpeg,image/webp,image/avif"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file && uploadTarget)
            upload.mutate({ file, target: uploadTarget });
        }}
      />
      {picker ? (
        <StoryImagePicker
          projectId={projectId}
          state={picker.state}
          usedFileIds={usedFileIds}
          addTitle={`选择${picker.label}`}
          replaceTitle={`替换${picker.label}`}
          searchLabel={`搜索${picker.label}`}
          projectEmptyCopy="上传一张透明 PNG，或从全局文件库选择。"
          onState={(state) => setPicker({ ...picker, state })}
          onChoose={(fileId) => bindFile(picker.target, fileId)}
          onUpload={() => openUpload(picker.target)}
          onClose={() => setPicker(undefined)}
        />
      ) : null}
    </section>
  );
}
