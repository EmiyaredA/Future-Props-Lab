import { BookOpen, Compass, Star, Send } from "lucide-react";
import { WorkshopNavigation } from "@shared/ui/WorkshopSidebar";
export type KnowledgeSection =
  "private" | "community" | "favorites" | "published";
export function KnowledgeSections({
  active,
  navigate,
}: {
  active: KnowledgeSection;
  navigate: (section: KnowledgeSection) => void;
}) {
  return (
    <WorkshopNavigation
      label="思绪工坊入口"
      items={[
        { id: "private", label: "我的知识库", icon: <BookOpen aria-hidden /> },
        { id: "community", label: "知识社区", icon: <Compass aria-hidden /> },
        { id: "favorites", label: "我的收藏", icon: <Star aria-hidden /> },
        { id: "published", label: "我的发布", icon: <Send aria-hidden /> },
      ].map((item) => ({
        ...item,
        active: active === item.id,
        onSelect: () => navigate(item.id as KnowledgeSection),
      }))}
    />
  );
}
