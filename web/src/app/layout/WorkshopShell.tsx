import { ResponsiveSidebar } from "@shared/ui/ResponsiveSidebar";
import type { ReactNode } from "react";
import type { ApplicationModule } from "@features/applications";
import {
  WorkshopSidebar,
  WorkshopNavigation,
} from "@shared/ui/WorkshopSidebar";
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
      <ResponsiveSidebar label={`${definition.name}导航`} routeKey={page}>
        <WorkshopSidebar
          name={definition.name}
          subtitle={shellConfig.subtitle}
          brandClassName={shellConfig.brandClassName}
          brand={
            definition.brandImage ? (
              <img
                src={definition.brandImage}
                alt=""
                aria-hidden
                draggable={false}
              />
            ) : (
              <BrandIcon aria-hidden />
            )
          }
          backSubtitle={shellConfig.backSubtitle}
          onBack={onBack}
        >
          <WorkshopNavigation
            label={`${definition.name}导航`}
            items={shellConfig.navigation.map((item) => ({
              id: item.page,
              label: item.label,
              icon: <item.icon aria-hidden />,
              active: item.activePages.includes(page),
              onSelect: () => navigate(item.page),
            }))}
          />
        </WorkshopSidebar>
      </ResponsiveSidebar>
      <main className="workshop-main">{children}</main>
    </div>
  );
}
