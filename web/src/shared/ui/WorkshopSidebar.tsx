import { ArrowLeft } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { ThemeToggle } from "./ThemeToggle";
import "./workshop-sidebar.css";

export function WorkshopSidebar({
  name,
  subtitle,
  brand,
  brandClassName,
  backSubtitle,
  onBack,
  children,
  className = "",
  sidebarRef,
  label,
  brandAction,
}: {
  name: string;
  subtitle: string;
  brand: ReactNode;
  brandClassName?: string;
  backSubtitle: string;
  onBack: () => void;
  children: ReactNode;
  className?: string;
  sidebarRef?: Ref<HTMLElement>;
  label?: string;
  brandAction?: ReactNode;
}) {
  return (
    <aside
      ref={sidebarRef}
      className={`workshop-sidebar ${className}`}
      aria-label={label}
    >
      <div
        className={["workshop-brand", brandClassName].filter(Boolean).join(" ")}
      >
        <span>{brand}</span>
        <div>
          <strong>{name}</strong>
          <small>{subtitle}</small>
        </div>
        {brandAction}
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
          <small>{backSubtitle}</small>
        </span>
      </button>
      {children}
      <footer>
        <ThemeToggle />
      </footer>
    </aside>
  );
}

export function WorkshopNavigation({
  label,
  items,
}: {
  label: string;
  items: {
    id: string;
    label: string;
    icon: ReactNode;
    active?: boolean;
    onSelect: () => void;
  }[];
}) {
  return (
    <nav className="workshop-navigation" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={item.active ? "active" : ""}
          aria-current={item.active ? "page" : undefined}
          aria-label={item.label}
          onClick={item.onSelect}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
