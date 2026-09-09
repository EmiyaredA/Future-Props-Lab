import { Clock, Files, Star, Trash2 } from "lucide-react";

export const documentViews = [
  { id: "all", label: "全部文档", Icon: Files },
  { id: "recent", label: "最近编辑", Icon: Clock },
  { id: "favorites", label: "收藏文档", Icon: Star },
  { id: "trash", label: "文档回收站", Icon: Trash2 },
];
