import {
  CheckCircle2,
  CircleDashed,
  FileText,
  Image,
  Gauge,
  Music,
  Sparkles,
  Video,
} from "lucide-react";

export const statusIcons = {
  待准备: CircleDashed,
  可生成: Sparkles,
  生成中: Gauge,
  已完成: CheckCircle2,
};
export const typeIcons = {
  text: FileText,
  image: Image,
  audio: Music,
  video: Video,
};
export const statusKeys = {
  待准备: "waiting",
  可生成: "ready",
  生成中: "running",
  已完成: "done",
};
