import { useState, type ReactNode } from "react";
import { ChevronDown, Folder } from "lucide-react";

export function HomeResourceSection({
  id,
  title,
  description,
  icon: Icon,
  action,
  onOpen,
  children,
  headerActions,
}: {
  id: string;
  title: string;
  description?: string;
  icon: typeof Folder;
  action?: string;
  onOpen?: () => void;
  children: ReactNode;
  headerActions?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section id={id} className="home-resource home-panel" tabIndex={-1}>
      <header className="home-section-heading">
        <span className="home-copper-icon">
          <Icon aria-hidden />
        </span>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <div className="home-resource-actions">
          {action && onOpen && (
            <button className="home-text-link" onClick={onOpen}>
              {action}
            </button>
          )}
          {headerActions}
          <button
            className="home-collapse"
            aria-expanded={open}
            aria-controls={`${id}-content`}
            onClick={() => setOpen(!open)}
          >
            {open ? "收起" : "展开"}
            <ChevronDown aria-hidden data-open={open} />
          </button>
        </div>
      </header>
      <div id={`${id}-content`} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
