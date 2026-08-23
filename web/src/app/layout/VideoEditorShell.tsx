import { ArrowLeft, Box, ListVideo } from "lucide-react";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import type { WorkshopPage } from "@app/routes";
import "@features/visual-workshop/visual-workshop.css";

const items = [
  { page: "video-editor-projects" as const, label: "剪辑项目", icon: Box },
  { page: "video-editor-tasks" as const, label: "渲染任务", icon: ListVideo },
];

export function VideoEditorShell({
  page,
  navigate,
  onBack,
  children,
}: {
  page: WorkshopPage;
  navigate: (page: WorkshopPage) => void;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="workshop-shell video-editor-shell">
      <aside className="workshop-sidebar">
        <div className="workshop-brand video-editor-brand">
          <span>
            <ListVideo aria-hidden />
          </span>
          <div>
            <strong>视频剪辑工坊</strong>
            <small>Video Editor</small>
          </div>
        </div>
        <button className="workshop-back" type="button" onClick={onBack}>
          <span className="workshop-back-icon">
            <ArrowLeft aria-hidden />
          </span>
          <span className="workshop-back-copy">
            <strong>返回应用中心</strong>
            <small>浏览全部应用</small>
          </span>
        </button>
        <nav aria-label="视频剪辑工坊导航">
          {items.map((item) => {
            const Icon = item.icon;
            const active = page === item.page;
            return (
              <button
                key={item.page}
                type="button"
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
                onClick={() => navigate(item.page)}
              >
                <Icon aria-hidden />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <footer>
          <ThemeToggle />
        </footer>
      </aside>
      <main className="workshop-main">{children}</main>
    </div>
  );
}
