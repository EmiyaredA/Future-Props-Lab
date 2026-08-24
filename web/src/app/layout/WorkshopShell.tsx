import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import type { ApplicationModule } from "@features/applications";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import "@app/layout/workshop-shell.css";

export function WorkshopShell({
  module,
  page,
  navigate,
  onBack,
  children,
}: {
  module: ApplicationModule;
  page: string;
  navigate: (page: string) => void;
  onBack: () => void;
  children: ReactNode;
}) {
  const { definition, shellConfig } = module;
  const BrandIcon = definition.icon;
  return (
    <div
      className={["workshop-shell", shellConfig.className]
        .filter(Boolean)
        .join(" ")}
    >
      <aside className="workshop-sidebar">
        <div
          className={["workshop-brand", shellConfig.brandClassName]
            .filter(Boolean)
            .join(" ")}
        >
          <span>
            {definition.brandImage ? (
              <img
                src={definition.brandImage}
                alt=""
                aria-hidden
                draggable={false}
              />
            ) : (
              <BrandIcon aria-hidden />
            )}
          </span>
          <div>
            <strong>{definition.name}</strong>
            <small>{shellConfig.subtitle}</small>
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
            <small>{shellConfig.backSubtitle}</small>
          </span>
        </button>
        <nav aria-label={`${definition.name}导航`}>
          {shellConfig.navigation.map((item) => {
            const Icon = item.icon;
            const active = item.activePages.includes(page);
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
