import { useRef, useState, type CSSProperties } from "react";
import type { ApplicationDefinition } from "@features/applications";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import "./application-folders.css";

const groups = [
  {
    id: "visual",
    name: "视觉与叙事",
    description: "图像 · 故事 · 三维",
    color: "#a67d55",
    apps: ["visual-workshop", "galgame-workshop", "director-desk"],
  },
  {
    id: "knowledge",
    name: "知识与表达",
    description: "笔记 · 演示",
    color: "#8a7b9b",
    apps: ["thought-workshop", "presentation-workshop"],
  },
  {
    id: "media",
    name: "影像与声音",
    description: "剪辑 · 特效 · 标注",
    color: "#64877e",
    apps: ["video-editor", "motion-compositor", "audio-annotation"],
  },
  {
    id: "development",
    name: "开发与协作",
    description: "面试 · 练习",
    color: "#718596",
    apps: ["interview-assistant"],
  },
];

/** Matte folder geometry adapted from React Bits Folder. See folder-source.md. */
export function HomeApplicationFolders({
  applications,
  onNavigate,
}: {
  applications: readonly ApplicationDefinition[];
  onNavigate: (path: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  return (
    <div
      className="home-folder-grid"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(null);
          triggers.current.get(open)?.focus();
        }
      }}
    >
      {groups.map((group) => {
        const apps = group.apps.flatMap(
          (id) => applications.find((app) => app.id === id) ?? [],
        );
        const expanded = open === group.id;
        return (
          <div
            key={group.id}
            className="home-folder"
            data-open={expanded}
            data-count={apps.length}
            style={{ "--folder-color": group.color } as CSSProperties}
          >
            <div className="home-folder-stage">
              <svg
                className="home-folder-back"
                viewBox="0 0 240 166"
                aria-hidden
              >
                <path d="M0 30Q0 18 12 18H112C130 18 124 0 143 0H178C197 0 191 18 210 18H228Q240 18 240 30V154Q240 166 228 166H12Q0 166 0 154Z" />
              </svg>
              <button
                className="home-folder-trigger"
                ref={(node) => {
                  if (node) triggers.current.set(group.id, node);
                  else triggers.current.delete(group.id);
                }}
                aria-expanded={expanded}
                aria-controls={`folder-${group.id}`}
                aria-label={`${group.name}，${apps.length} 个应用`}
                onClick={() => setOpen(expanded ? null : group.id)}
              >
                <span className="home-folder-front" />
              </button>
              <div
                id={`folder-${group.id}`}
                className="home-folder-papers"
                aria-label={`${group.name}应用`}
              >
                {apps.map((app, index) => (
                  <button
                    key={app.id}
                    className="home-folder-paper"
                    style={
                      {
                        "--paper-index": index,
                        "--paper-count": apps.length,
                      } as CSSProperties
                    }
                    tabIndex={expanded ? 0 : -1}
                    aria-hidden={!expanded}
                    aria-label={`打开${app.name}`}
                    onClick={() => onNavigate(app.path)}
                  >
                    {app.brandImage ? (
                      <ResponsiveImage
                        src={app.brandImage}
                        alt=""
                        width={100}
                        height={100}
                      />
                    ) : (
                      <app.icon aria-hidden />
                    )}
                    <span>{app.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <button
              className="home-folder-caption"
              aria-expanded={expanded}
              aria-controls={`folder-${group.id}`}
              onClick={() => {
                setOpen(expanded ? null : group.id);
                triggers.current.get(group.id)?.focus();
              }}
            >
              <strong>
                {group.name}
                <small>{apps.length}</small>
              </strong>
              <span>{group.description}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
