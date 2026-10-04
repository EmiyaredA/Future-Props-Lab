import { useEffect, useState } from "react";
import { AccountWorkspacePanel } from "@features/accounts";
import {
  getPublicGalgameStory,
  getPublicWorkspace,
  type PublicWorkspaceProjection,
} from "@features/public-workspace";
import { useStudioSession } from "@app/StudioSession";
import { BrandMark } from "@shared/ui/BrandMark";
import { ThemeToggle } from "@shared/ui/ThemeToggle";

type PublicAsset = {
  id: string;
  display_name: string;
  media_kind: string;
  mime_type: string;
  preview_url: string;
};
type PublicProject = {
  is_official: boolean;
  id: string;
  title: string;
  status: string;
  kind?: string;
  updated_at: string;
  assets: PublicAsset[];
};
export function PublicWorkspaceShowcase({
  onOpenCommunity,
}: {
  onOpenCommunity?: () => void;
}) {
  const session = useStudioSession();
  const { me } = session;
  const [projection, setProjection] =
    useState<PublicWorkspaceProjection | null>(null);
  const [story, setStory] = useState<{
    projectId: string;
    document: unknown;
  } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getPublicWorkspace()
      .then(setProjection)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "展台加载失败"),
      );
  }, [me.workspace.id]);

  const assetUrl = (path: string) =>
    `${String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "")}${path}`;

  return (
    <div className="public-showcase-shell">
      <header className="public-showcase-header">
        <div className="public-showcase-brand">
          <BrandMark size={38} />
          <div>
            <strong>Future Props Showcase</strong>
            <small>登录可见的公开作品展台</small>
          </div>
        </div>
        <div className="public-showcase-actions">
          {onOpenCommunity && (
            <button className="btn" onClick={onOpenCommunity}>
              知识社区
            </button>
          )}
          <ThemeToggle />
          <AccountWorkspacePanel session={session} />
        </div>
      </header>
      <main className="public-showcase-main">
        <div className="public-showcase-hero">
          <span>PUBLIC WORKSPACE</span>
          <h1>{projection?.workspace_name || me.workspace.name}</h1>
          <p>
            这里仅展示空间所有者公开的视觉作品和互动故事，不包含模型、提示词、任务或运行日志。
          </p>
        </div>
        {error ? <div className="inline-alert danger">{error}</div> : null}
        <ShowcaseSection
          title="视觉项目"
          projects={projection?.visual_projects || []}
          assetUrl={assetUrl}
        />
        <section className="showcase-section">
          <div className="showcase-section-head">
            <h2>Galgame 作品</h2>
            <span>{projection?.galgame_projects.length || 0} 个项目</span>
          </div>
          <div className="showcase-project-grid">
            {(projection?.galgame_projects || []).map((project) => (
              <article className="showcase-project" key={project.id}>
                <div>
                  <small>{project.status}</small>
                  <h3>
                    {project.title}{" "}
                    {project.is_official && (
                      <small className="workshop-status completed">
                        官方作品
                      </small>
                    )}
                  </h3>
                </div>
                <AssetGallery assets={project.assets} assetUrl={assetUrl} />
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    void getPublicGalgameStory(project.id)
                      .then((result) =>
                        setStory({
                          projectId: project.id,
                          document: result.document,
                        }),
                      )
                      .catch((reason) =>
                        setError(
                          reason instanceof Error
                            ? reason.message
                            : "故事加载失败",
                        ),
                      )
                  }
                >
                  打开故事内容
                </button>
                {story?.projectId === project.id ? (
                  <PublicStoryPlayer document={story.document} />
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function PublicStoryPlayer({ document }: { document: unknown }) {
  const [position, setPosition] = useState(0);
  const project =
    document && typeof document === "object"
      ? (document as Record<string, unknown>)
      : {};
  const chapters = Array.isArray(project.chapters) ? project.chapters : [];
  const blocks = chapters
    .flatMap((chapter) => {
      if (!chapter || typeof chapter !== "object") return [];
      const fragments = Array.isArray(
        (chapter as Record<string, unknown>).fragments,
      )
        ? ((chapter as Record<string, unknown>).fragments as unknown[])
        : [];
      return fragments.flatMap((fragment) => {
        if (!fragment || typeof fragment !== "object") return [];
        const value = (fragment as Record<string, unknown>).blocks;
        return Array.isArray(value) ? value : [];
      });
    })
    .filter((block) => block && typeof block === "object") as Record<
    string,
    unknown
  >[];
  const visible = blocks.filter((block) =>
    [
      "dialogue",
      "narration",
      "storyParagraph",
      "systemMessage",
      "floatingText",
    ].includes(String(block.type)),
  );
  const current = visible[Math.min(position, Math.max(visible.length - 1, 0))];
  const characters = new Map(
    (Array.isArray(project.characters) ? project.characters : []).flatMap(
      (character) => {
        if (!character || typeof character !== "object") return [];
        const row = character as Record<string, unknown>;
        return [[String(row.id), String(row.name || "角色")]] as const;
      },
    ),
  );
  if (!current)
    return <p className="empty-copy">这个故事还没有可播放的正文。</p>;
  const content = textContent(current.content) || String(current.text || "…");
  const speaker = current.characterId
    ? characters.get(String(current.characterId))
    : null;
  return (
    <div className="public-story-player" aria-label="公开故事播放器">
      <div className="public-story-stage">
        <span>
          {speaker || (current.type === "dialogue" ? "角色" : "旁白")}
        </span>
        <p>{content}</p>
      </div>
      <div className="button-row">
        <button
          type="button"
          className="btn small"
          disabled={position === 0}
          onClick={() => setPosition((value) => Math.max(0, value - 1))}
        >
          上一句
        </button>
        <span>
          {position + 1} / {visible.length}
        </span>
        <button
          type="button"
          className="btn small primary"
          disabled={position >= visible.length - 1}
          onClick={() =>
            setPosition((value) => Math.min(visible.length - 1, value + 1))
          }
        >
          继续
        </button>
      </div>
    </div>
  );
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textContent).join("");
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  return [row.text, row.value, row.children, row.nodes]
    .map(textContent)
    .join("");
}

function ShowcaseSection({
  title,
  projects,
  assetUrl,
}: {
  title: string;
  projects: PublicProject[];
  assetUrl: (path: string) => string;
}) {
  return (
    <section className="showcase-section">
      <div className="showcase-section-head">
        <h2>{title}</h2>
        <span>{projects.length} 个项目</span>
      </div>
      <div className="showcase-project-grid">
        {projects.map((project) => (
          <article className="showcase-project" key={project.id}>
            <div>
              <small>{project.kind || project.status}</small>
              <h3>
                {project.title}{" "}
                {project.is_official && (
                  <small className="workshop-status completed">官方作品</small>
                )}
              </h3>
            </div>
            <AssetGallery assets={project.assets} assetUrl={assetUrl} />
          </article>
        ))}
      </div>
    </section>
  );
}

function AssetGallery({
  assets,
  assetUrl,
}: {
  assets: PublicAsset[];
  assetUrl: (path: string) => string;
}) {
  if (!assets.length)
    return <p className="empty-copy">这个项目还没有公开素材。</p>;
  return (
    <div className="showcase-assets">
      {assets.map((asset) =>
        asset.mime_type.startsWith("image/") ? (
          <figure key={asset.id}>
            <img
              src={assetUrl(asset.preview_url)}
              alt={asset.display_name}
              loading="lazy"
            />
            <figcaption>{asset.display_name}</figcaption>
          </figure>
        ) : asset.mime_type.startsWith("video/") ? (
          <figure key={asset.id}>
            <video
              src={assetUrl(asset.preview_url)}
              controls
              preload="metadata"
            />
            <figcaption>{asset.display_name}</figcaption>
          </figure>
        ) : (
          <a
            key={asset.id}
            href={assetUrl(asset.preview_url)}
            target="_blank"
            rel="noreferrer"
          >
            {asset.display_name}
          </a>
        ),
      )}
    </div>
  );
}
