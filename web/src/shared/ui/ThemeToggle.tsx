import { useTheme } from "@shared/ui/theme";

function Sun() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function Moon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
    </svg>
  );
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useTheme();
  return (
    <div
      className={`theme-toggle${compact ? " theme-toggle--compact" : ""}`}
      role="group"
      aria-label="外观模式"
    >
      <button
        type="button"
        className={theme === "light" ? "active" : ""}
        aria-pressed={theme === "light"}
        aria-label="浅色"
        onClick={() => setTheme("light")}
      >
        <Sun />
        <span>浅色</span>
      </button>
      <button
        type="button"
        className={theme === "dark" ? "active" : ""}
        aria-pressed={theme === "dark"}
        aria-label="深色"
        onClick={() => setTheme("dark")}
      >
        <Moon />
        <span>深色</span>
      </button>
    </div>
  );
}
