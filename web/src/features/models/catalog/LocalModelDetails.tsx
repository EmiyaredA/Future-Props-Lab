import { ProgressBar } from "@shared/ui/LoadingState";
import { LoadingState } from "@shared/ui/LoadingState";
import { useState } from "react";
import {
  AudioLines,
  CheckCircle2,
  Circle,
  ExternalLink,
  Play,
  Plus,
  Power,
  Video,
} from "lucide-react";
import type { LocalModel } from "@features/models/localModelApi";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CatalogMenu } from "./CatalogMenu";
import {
  isBuiltinVideo,
  localModelNextStep,
  type localModelConnection,
} from "./localModelPresentation";
import type { ModelCatalogEditorProps } from "./catalogTypes";
import type { LocalModelAction } from "./useLocalModels";

export function LocalModelDetails({
  model,
  connection,
  canManage,
  canWrite,
  canTest,
  onTestModel,
  onOpenConnection,
  pending,
  stale,
  act,
  error,
}: {
  model: LocalModel;
  connection: ReturnType<typeof localModelConnection>;
  canManage: boolean;
  canWrite: boolean;
  canTest: boolean;
  onTestModel?: ModelCatalogEditorProps["onTestModel"];
  onOpenConnection?: (providerId: string) => void;
  pending: boolean;
  stale: boolean;
  act: (model: LocalModel, action: LocalModelAction) => Promise<boolean>;
  error: string;
}) {
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const builtin = isBuiltinVideo(model);
  const installed = model.status === "installed";
  const running = installed && model.enabled;
  const connectionEnabled =
    !!connection?.provider.enabled && !!connection?.model.enabled;
  const ready =
    running &&
    model.compatible &&
    connectionEnabled &&
    (!connection?.model.availability ||
      connection.model.availability === "ready");
  const next = localModelNextStep(model, !!connection, connectionEnabled);
  const disabled = pending || stale;
  const manageable = canManage && !disabled && !model.busy;
  const steps = [
    {
      title: builtin
        ? installed
          ? "本机环境已就绪"
          : "检查本机环境"
        : installed
          ? "已安装"
          : "安装到本机",
      description: builtin
        ? "使用本机 FFmpeg 和 VideoToolbox 硬件编码"
        : installed
          ? "模型文件已下载并安装到本机"
          : "下载模型与独立运行环境",
      complete: installed,
    },
    {
      title: running ? "服务已启用" : "启用本机服务",
      description: builtin
        ? "按需启动本机视频处理，无需 API Key"
        : running
          ? "首次调用时加载模型，无需 API Key"
          : "安装完成后自动启用；停止后需手动启用",
      complete: running,
    },
    {
      title: connection ? "已添加到当前空间" : "添加到当前空间",
      description: connection
        ? "仅当前空间可使用此接入，其他空间需分别添加"
        : "将本机模型接入当前空间，原有默认模型不变",
      complete: !!connection,
    },
  ];

  let primary:
    { label: string; action: () => void; disabled: boolean } | undefined;
  if (
    !builtin &&
    ["not_installed", "failed", "cancelled"].includes(model.status) &&
    canManage
  )
    primary = {
      label: model.status === "not_installed" ? "下载安装" : "重试安装",
      action: () => void act(model, "install"),
      disabled: disabled || !model.compatible,
    };
  else if (model.status === "installing" && canManage)
    primary = {
      label: "取消安装",
      action: () => void act(model, "cancel"),
      disabled,
    };
  else if (installed && !model.enabled && canManage)
    primary = {
      label: "启用服务",
      action: () => void act(model, "enable"),
      disabled: !manageable || !model.compatible,
    };
  else if (running && !connection && canWrite)
    primary = {
      label: "添加到当前空间",
      action: () => void act(model, "attach"),
      disabled: disabled || !model.compatible,
    };
  else if (connection && running && !connectionEnabled && onOpenConnection)
    primary = {
      label: "前往接入管理",
      action: () => onOpenConnection(connection.provider.id),
      disabled: pending,
    };
  else if (ready && canTest && onTestModel && connection)
    primary = {
      label: "去测试",
      action: () => onTestModel(connection.model, connection.provider),
      disabled,
    };

  const permissionHint =
    !builtin && !installed && !canManage
      ? "安装和运行管理由平台管理员在本机管理端操作。"
      : installed && !model.enabled && !canManage
        ? "请联系平台管理员启用本机服务。"
        : running && !connection && !canWrite
          ? "添加到当前空间需要工作区配置管理权限。"
          : ready && (!canTest || !onTestModel)
            ? "当前角色没有模型测试权限。"
            : null;
  const cleanupAvailable =
    !builtin && (installed || ["failed", "cancelled"].includes(model.status));
  const cleanupLabel = installed ? "卸载模型" : "清理下载";

  return (
    <article
      className="lm-detail"
      aria-label={`${model.label} 详情`}
      aria-busy={pending}
    >
      <header className="lm-detail-header">
        {model.capability === "video_enhancement" ? (
          <Video size={30} aria-hidden />
        ) : (
          <AudioLines size={30} aria-hidden />
        )}
        <div>
          <h2>{model.label}</h2>
          <p>
            {builtin
              ? "本机 FFmpeg · 免下载"
              : `下载 ${(model.download_bytes / 1e9).toFixed(2)} GB · 安装需 ${(model.required_disk_bytes / 1e9).toFixed(1)} GB`}
          </p>
          <small>
            {builtin ? "等比放大到 1080p 并轻微锐化" : "安装空间包含环境与暂存"}
          </small>
        </div>
      </header>
      <ol className="lm-steps" aria-label="模型使用步骤">
        {steps.map((step) => (
          <li className={step.complete ? "is-complete" : ""} key={step.title}>
            {step.complete ? (
              <CheckCircle2 size={22} aria-hidden />
            ) : (
              <Circle size={22} aria-hidden />
            )}
            <div>
              <strong>{step.title}</strong>
              <p>{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="lm-next-step">
        <h3>{next.title}</h3>
        <p>{next.description}</p>
        {model.status === "installing" && (
          <div className="lm-install-progress">
            <ProgressBar
              value={model.progress}
              label={`${model.label} 安装进度`}
            />
            <span role="status">安装进度 {model.progress}%</span>
          </div>
        )}
        {model.error_message && (
          <p className="lm-inline-error" role="alert">
            {model.error_message}
          </p>
        )}
        {primary && (
          <button
            type="button"
            className={`btn ${model.status === "installing" ? "" : "primary"}`}
            disabled={primary.disabled}
            onClick={primary.action}
          >
            {pending ? null : primary.label === "去测试" ? (
              <Play size={17} aria-hidden />
            ) : primary.label === "添加到当前空间" ? (
              <Plus size={17} aria-hidden />
            ) : null}
            {pending ? (
              <LoadingState variant="inline" label="处理中…" />
            ) : (
              primary.label
            )}
          </button>
        )}
        {permissionHint && (
          <p className="lm-permission-hint">{permissionHint}</p>
        )}
        {running && !connection && (
          <small>添加后可在模型测试中使用，不会更改默认模型。</small>
        )}
      </div>
      {installed && (
        <div className="lm-service">
          <div className="lm-service-actions">
            <strong>服务管理</strong>
            {canManage && running && (
              <button
                className="btn"
                type="button"
                disabled={!manageable}
                onClick={() => void act(model, "stop")}
              >
                <Power size={16} aria-hidden />
                停止服务
              </button>
            )}
            {canManage && cleanupAvailable && (
              <CatalogMenu
                label={`${model.label} 更多操作`}
                items={[
                  {
                    label: cleanupLabel,
                    danger: true,
                    disabled: !manageable,
                    onClick: () => setConfirmCleanup(true),
                  },
                ]}
              />
            )}
          </div>
          <p className="lm-memory">
            {model.busy ? (
              <LoadingState
                variant="inline"
                label={
                  model.capability === "video_enhancement"
                    ? "本机正在处理视频，完成后可管理服务。"
                    : "正在生成语音，完成后可管理服务。"
                }
              />
            ) : builtin ? (
              "空闲 · 按需启动视频处理。"
            ) : model.loaded ? (
              "模型已加载 · 空闲 5 分钟后自动释放内存。"
            ) : (
              "内存空闲 · 首次调用时加载模型。"
            )}
          </p>
          <small>停止服务会影响本机所有空间对此模型的调用。</small>
          {!canManage && (
            <p className="lm-permission-hint">
              安装和运行管理由平台管理员在本机管理端操作。
            </p>
          )}
        </div>
      )}
      {!installed && cleanupAvailable && canManage && (
        <div className="lm-service-actions">
          <span>安装文件管理</span>
          <CatalogMenu
            label={`${model.label} 更多操作`}
            items={[
              {
                label: cleanupLabel,
                danger: true,
                disabled: !manageable,
                onClick: () => setConfirmCleanup(true),
              },
            ]}
          />
        </div>
      )}
      {canManage && installed && !builtin && (
        <button
          className="btn"
          disabled={!manageable || pending || model.busy}
          onClick={() => void act(model, "repair")}
        >
          修复运行环境
        </button>
      )}
      <footer className="lm-source">
        <a
          href={
            builtin
              ? "https://ffmpeg.org/"
              : `https://huggingface.co/${model.repository}`
          }
          target="_blank"
          rel="noreferrer"
        >
          {builtin ? "FFmpeg" : "Hugging Face"}{" "}
          <ExternalLink size={13} aria-hidden />
          <span className="lm-sr-only">（新窗口打开）</span>
        </a>
        <span>{model.license}</span>
      </footer>
      <ConfirmDialog
        open={confirmCleanup}
        title={`${cleanupLabel}「${model.label}」？`}
        confirmLabel={cleanupLabel}
        pending={pending}
        confirmDisabled={!manageable || !cleanupAvailable}
        onCancel={() => setConfirmCleanup(false)}
        onConfirm={async () => {
          if (manageable && cleanupAvailable && (await act(model, "uninstall")))
            setConfirmCleanup(false);
        }}
        description={
          <>
            <p>
              这会清理本机共享的模型文件，所有空间对此模型的调用都会受影响。历史音频仍保留。
            </p>
            {error && <p role="alert">{error}</p>}
          </>
        }
      />
    </article>
  );
}
