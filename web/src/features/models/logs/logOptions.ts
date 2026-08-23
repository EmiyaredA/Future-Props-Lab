export const providerLabels: Record<string, string> = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic",
  senseaudio_image: "SenseAudio 图片",
  senseaudio_video: "SenseAudio 视频",
  senseaudio_asr: "SenseAudio 语音识别",
  senseaudio_realtime: "SenseAudio 实时语音",
};

export const logProviderKindOptions = [
  { value: "", label: "全部供应商" },
  { value: "openai", label: "OpenAI 兼容" },
  { value: "anthropic", label: "Anthropic" },
  { value: "senseaudio_asr", label: "SenseAudio 语音识别" },
  { value: "senseaudio_realtime", label: "SenseAudio 实时语音" },
];
