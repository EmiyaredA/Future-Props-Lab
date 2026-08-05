import { ArrowLeft, Box } from "lucide-react";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import type { WorkshopPage } from "@app/routes";
import "@features/visual-workshop/visual-workshop.css";

const items = [
  {
    page: "galgame-workshop-projects" as const,
    label: "项目工作台",
    icon: Box,
  },
];

export function GalgameWorkshopShell({
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
    <div className="workshop-shell galgame-workshop-shell">
      <aside className="workshop-sidebar">
        <div className="workshop-brand">
          <span>
            <img
              src="/brand/galgame-workshop-mark.png"
              alt=""
              aria-hidden
              draggable={false}
            />
          </span>
          <div>
            <strong>Galgame 工坊</strong>
            <small>Galgame Workshop</small>
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
        <nav aria-label="Galgame 工坊导航">
          {items.map((item) => {
            const Icon = item.icon;
            const active =
              page === item.page ||
              page === "galgame-workshop-overview" ||
              page === "galgame-workshop-editor";
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
