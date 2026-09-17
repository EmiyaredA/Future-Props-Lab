import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";
import "./workshop-app-chrome.css";

export function WorkshopAppChrome({
  eyebrow,
  title,
  description,
  actions,
  className = "",
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={["workshop-app-chrome", className].filter(Boolean).join(" ")}
    >
      <div className="workshop-app-chrome__copy">
        {eyebrow ? (
          <span className="workshop-app-chrome__eyebrow">{eyebrow}</span>
        ) : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="workshop-app-chrome__actions">
        {actions}
        <div className="workshop-app-chrome__theme">
          <span>外观</span>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
