import { useEffect, useState, type ReactNode } from "react";
import { useDrawerFocus } from "./useDrawerFocus";
import { Menu, X } from "lucide-react";
import "./responsive-sidebar.css";

export function ResponsiveSidebar({
  children,
  label,
  routeKey,
}: {
  children: ReactNode;
  label: string;
  routeKey: string;
}) {
  const [open, setOpen] = useState(false);
  const panel = useDrawerFocus<HTMLDivElement>(() => setOpen(false), open);
  useEffect(() => {
    setOpen(false);
  }, [routeKey]);
  useEffect(() => {
    if (!open) return;
    const media = matchMedia("(max-width: 1200px)");
    const closeOnDesktop = () => {
      if (!media.matches) setOpen(false);
    };
    media.addEventListener("change", closeOnDesktop);
    return () => {
      media.removeEventListener("change", closeOnDesktop);
    };
  }, [open]);
  return (
    <div className="responsive-sidebar-track">
      <button
        className="responsive-nav-trigger"
        aria-label={`打开${label}`}
        aria-expanded={open}
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
      >
        <Menu size={18} />
        导航
      </button>
      {open && (
        <button
          className="responsive-nav-backdrop"
          aria-label={`关闭${label}遮罩`}
          onClick={() => setOpen(false)}
        />
      )}
      <div
        ref={panel}
        className={`responsive-sidebar-panel${open ? " is-open" : ""}`}
        role={open ? "dialog" : undefined}
        aria-modal={open || undefined}
        aria-label={open ? label : undefined}
      >
        <button
          className="responsive-nav-close"
          aria-label={`关闭${label}`}
          onClick={() => setOpen(false)}
        >
          <X size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}
