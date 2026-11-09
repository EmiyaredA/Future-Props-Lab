import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";
import "./workshop-app-chrome.css";

export function WorkshopAppChrome({
  eyebrow,
  title,
  description,
  actions,
  utilities,
  className = "",
  showThemeToggle = true,
}: {
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  utilities?: ReactNode;
  className?: string;
  showThemeToggle?: boolean;
}) {
  return (
    <header
      className={[
        "workshop-app-chrome",
        utilities && "workshop-app-chrome--compact",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role={utilities ? "region" : undefined}
      aria-label={utilities ? "工坊公共工具栏" : undefined}
    >
      {(title || eyebrow || description) && (
        <div className="workshop-app-chrome__copy">
          {eyebrow ? (
            <span className="workshop-app-chrome__eyebrow">{eyebrow}</span>
          ) : null}
          {title && <h1>{title}</h1>}
          {description ? <p>{description}</p> : null}
        </div>
      )}
      <div className="workshop-app-chrome__actions">
        {actions}
        {!utilities && showThemeToggle ? (
          <div className="workshop-app-chrome__theme">
            <span>外观</span>
            <ThemeToggle />
          </div>
        ) : null}
      </div>
      {utilities}
    </header>
  );
}

export function WorkshopSearch({
  label,
  placeholder = label,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="workshop-header-search">
      <Search size={16} aria-hidden />
      <input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
