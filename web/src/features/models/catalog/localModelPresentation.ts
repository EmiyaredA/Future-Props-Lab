import type { LocalModel } from "@features/models/localModelApi";
import type { ModelCatalogValue } from "./catalogTypes";

export function isBuiltinVideo(model: LocalModel) {
  return model.capability === "video_enhancement" && model.download_bytes === 0;
}

export function localModelStatus(model: LocalModel) {
  if (!model.compatible)
    return isBuiltinVideo(model)
      ? "环境不可用"
      : model.capability === "video_enhancement"
        ? "待本机验收"
        : "平台不支持";
  if (model.status === "installed") {
    if (model.busy && model.enabled) return "正在生成";
    return model.enabled ? "已启用" : "服务已停止";
  }
  return (
    {
      not_installed: "未安装",
      installing: `安装中 ${model.progress}%`,
      failed: "安装失败",
      cancelled: "已取消",
    }[model.status] ?? "状态待确认"
  );
}

export function localModelConnection(
  catalog: Pick<ModelCatalogValue, "providers">,
  modelId: string,
) {
  const matches = catalog.providers
    .filter((provider) =>
      ["local_qwen_tts", "local_relayvsr", "local_ffmpeg"].includes(
        provider.kind,
      ),
    )
    .flatMap((provider) =>
      provider.models
        .filter((model) => model.slug === modelId)
        .map((model) => ({ model, provider })),
    );
  return (
    matches.find(({ model, provider }) => model.enabled && provider.enabled) ??
    matches[0]
  );
}

export function localModelNextStep(
  model: LocalModel,
  attached: boolean,
  connectionEnabled: boolean,
) {
  if (model.capability === "video_enhancement") {
    if (isBuiltinVideo(model) && !model.compatible)
      return {
        title: "本机视频增强环境不可用",
        description:
          "需要支持 VideoToolbox 的 FFmpeg 和 ffprobe，以及 Apple Silicon Mac（macOS 15+）。",
      };
    if (!model.compatible)
      return {
        title: "待本机 Metal 验收",
        description: "通过实机验证后可以安装。",
      };
    if (model.enabled && attached && connectionEnabled)
      return {
        title: "已就绪，可以开始测试",
        description: "选择 MP4 或 MOV 影片，自动分段增强到 1080p。",
      };
    if (model.status === "not_installed")
      return {
        title: "准备本地视频增强",
        description: "按需下载 RelayVSR 权重。",
      };
    if (model.enabled && !attached)
      return {
        title: "可添加到当前空间",
        description: "接入当前空间后可以测试视频增强。",
      };
    if (model.status === "installed" && !model.enabled && isBuiltinVideo(model))
      return {
        title: "启用后即可使用",
        description: "使用本机 FFmpeg 放大并轻微锐化，无需下载模型权重。",
      };
  }
  if (!model.compatible)
    return {
      title: "当前设备暂不支持",
      description: "需要 macOS 15 或更新版本的 Apple Silicon Mac。",
    };
  if (model.status === "installing")
    return {
      title: "正在安装到本机",
      description: "首次安装包含独立运行环境；完成后会自动启用服务。",
    };
  if (model.status !== "installed")
    return {
      title:
        model.status === "failed" ? "安装未完成，请重试" : "准备本地语音合成",
      description: "按需下载模型与运行环境，不会在应用启动时自动安装。",
    };
  if (!model.enabled)
    return {
      title: "启用后即可使用",
      description: "模型文件已保留在本机，无需重新下载。",
    };
  if (!attached)
    return {
      title: "可添加到当前空间",
      description: "服务已启用，将模型接入当前空间后即可用于语音合成。",
    };
  if (!connectionEnabled)
    return {
      title: "当前空间的接入已停用",
      description: "模型已添加，请在接入管理中启用对应连接和模型。",
    };
  return {
    title: "已就绪，可以开始测试",
    description: "准备一段 3–30 秒参考录音及对应文字，即可生成语音。",
  };
}
