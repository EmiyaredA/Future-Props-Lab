import { ArrowLeft, Box, ListChecks } from "lucide-react";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import type { WorkshopPage } from "@app/routes";

const items = [
  { page: "visual-workshop-projects", label: "项目工作台", icon: Box },
  { page: "visual-workshop-tasks", label: "生成任务", icon: ListChecks },
] as const;

export function VisualWorkshopShell({
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
    <div className="workshop-shell">
      <aside className="workshop-sidebar">
        <div className="workshop-brand">
          <span>
            <img
              src="/brand/visual-workshop-mark.png"
              alt=""
              aria-hidden
              draggable={false}
            />
          </span>
          <div>
            <strong>视觉创作工坊</strong>
            <small>Visual Workshop</small>
          </div>
        </div>
        <button
          className="workshop-back"
          type="button"
          aria-label="返回应用中心"
          onClick={onBack}
        >
          <span className="workshop-back-icon">
            <ArrowLeft aria-hidden />
          </span>
          <span className="workshop-back-copy">
            <strong>返回应用中心</strong>
            <small>浏览全部 AI 应用</small>
          </span>
        </button>
        <nav aria-label="视觉创作工坊导航">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.page}
                type="button"
                className={page === item.page ? "active" : ""}
                aria-current={page === item.page ? "page" : undefined}
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
