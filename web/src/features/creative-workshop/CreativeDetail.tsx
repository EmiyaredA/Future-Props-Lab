import { useEffect, useState } from "react";
import {
  configureStdio,
  getCreative,
  getCreativeRelease,
  installCreative,
  previewInstall,
  type CreativeItem,
  type CreativeRelease,
  type InstallPreview,
} from "./api";
import { errorText, labels, type Nav } from "./shared";
import { Cover } from "./Cover";

export function Detail({
  itemId,
  canInstall,
  navigate,
}: {
  itemId?: string;
  canInstall: boolean;
  navigate: Nav;
}) {
  const [item, setItem] = useState<CreativeItem | null>(null);
  const [releases, setReleases] = useState<CreativeRelease[]>([]);
  const [preview, setPreview] = useState<InstallPreview | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [installed, setInstalled] = useState(false);
  const [installation, setInstallation] = useState<{
    id: string;
    resources: { release_id: string; state: string; name: string }[];
  } | null>(null);
  const [stdioCommands, setStdioCommands] = useState<Record<string, string>>(
    {},
  );
  const [stdioArguments, setStdioArguments] = useState<Record<string, string>>(
    {},
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!itemId) return;
    let active = true;
    getCreative(itemId)
      .then(async (value) => {
        if (!active) return;
        setItem(value);
        setReleases(
          await Promise.all(value.components.map(getCreativeRelease)),
        );
      })
      .catch((cause) => active && setError(errorText(cause)));
    return () => {
      active = false;
    };
  }, [itemId]);
  const releaseId = item?.current_release_id;
  const check = async (nextNames = names) => {
    if (!releaseId) return;
    setBusy(true);
    setError("");
    try {
      setPreview(await previewInstall(releaseId, nextNames));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!item)
    return <p className="creative-empty">{error || "正在加载方案详情…"}</p>;
  return (
    <>
      <div className="creative-section-heading">
        <button
          className="creative-text-button"
          onClick={() => navigate("creative-workshop")}
        >
          ← 返回创意广场
        </button>
      </div>
      <div className="creative-detail">
        <div className="creative-detail-main">
          <Cover item={item} />
          <div className="creative-detail-copy">
            <span className="creative-badge">
              {labels[item.kind]} · v{item.version}
            </span>
            <h2>{item.title}</h2>
            <p>{item.summary}</p>
            <div className="creative-author">由 {item.author_name} 发布</div>
            {item.tags.length > 0 && (
              <div className="creative-tags">
                {item.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            )}
          </div>
          <section>
            <h3>用途与使用说明</h3>
            <p className="creative-prose">
              {item.description || "作者暂未提供详细说明。"}
            </p>
          </section>
          {item.kind === "bundle" && (
            <section>
              <h3>包含的公开能力 · {releases.length} 项</h3>
              <div className="creative-selected">
                {releases.map((release) => (
                  <div key={release.id}>
                    <span>{labels[release.kind]}</span>
                    <strong>{release.title}</strong>
                    <small>
                      v{release.version} · 原作者 {release.author_name}
                    </small>
                    <button
                      onClick={() =>
                        navigate("creative-workshop-detail", release.item_id)
                      }
                    >
                      查看
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
        <aside className="creative-detail-aside">
          <h3>复制到当前 Workspace</h3>
          <p>安装的是固定版本的独立副本，发布者以后更新不会改变现有配置。</p>
          {!item.installable && (
            <p className="creative-error">
              所含能力已撤回，当前方案暂不可安装。
            </p>
          )}
          {!canInstall && (
            <p className="creative-hint">需要集成管理权限才能安装。</p>
          )}
          {installed ? (
            <div className="creative-installed">
              <strong>安装完成</strong>
              <p>已导入的能力默认禁用。请到集成中心检查配置后启用。</p>
              {installation?.resources
                .filter((resource) => resource.state === "pending_setup")
                .map((resource) => (
                  <div
                    className="creative-stdio-setup"
                    key={resource.release_id}
                  >
                    <label>
                      {resource.name} · 本机命令
                      <input
                        placeholder="例如 npx"
                        value={stdioCommands[resource.release_id] || ""}
                        onChange={(event) =>
                          setStdioCommands((previous) => ({
                            ...previous,
                            [resource.release_id]: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      参数（每行一项）
                      <textarea
                        rows={3}
                        placeholder={"-y\n@scope/server"}
                        value={stdioArguments[resource.release_id] || ""}
                        onChange={(event) =>
                          setStdioArguments((previous) => ({
                            ...previous,
                            [resource.release_id]: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <button
                      className="creative-secondary"
                      disabled={busy || !stdioCommands[resource.release_id]}
                      onClick={() => {
                        setBusy(true);
                        configureStdio(
                          installation.id,
                          resource.release_id,
                          stdioCommands[resource.release_id],
                          (stdioArguments[resource.release_id] || "")
                            .split("\n")
                            .map((part) => part.trim())
                            .filter(Boolean),
                        )
                          .then(setInstallation)
                          .catch((cause) => setError(errorText(cause)))
                          .finally(() => setBusy(false));
                      }}
                    >
                      保存本机配置
                    </button>
                  </div>
                ))}
              <button
                className="creative-secondary"
                onClick={() => navigate("creative-workshop")}
              >
                返回广场
              </button>
            </div>
          ) : (
            <>
              {!preview && (
                <button
                  className="creative-primary"
                  disabled={!canInstall || !item.installable || busy}
                  onClick={() => void check()}
                >
                  检查安装依赖
                </button>
              )}
              {preview && (
                <>
                  <div className="creative-install-list">
                    {preview.parts.map((part) => (
                      <label key={part.release_id}>
                        <span>
                          {labels[part.kind]} · {part.title}
                        </span>
                        <input
                          value={names[part.release_id] ?? part.target_name}
                          disabled={part.already_installed}
                          onChange={(event) =>
                            setNames((previous) => ({
                              ...previous,
                              [part.release_id]: event.target.value,
                            }))
                          }
                        />
                        <small>
                          {part.conflict
                            ? "名称冲突，请修改"
                            : part.already_installed
                              ? "当前工作区已安装此版本"
                              : part.pending_setup
                                ? "安装后需配置本机命令"
                                : "将以禁用状态导入"}
                        </small>
                      </label>
                    ))}
                  </div>
                  <button
                    className="creative-secondary"
                    disabled={busy}
                    onClick={() => void check()}
                  >
                    重新检查名称
                  </button>
                  <button
                    className="creative-primary"
                    disabled={busy || !preview.installable}
                    onClick={() => {
                      if (!releaseId) return;
                      setBusy(true);
                      installCreative(releaseId, names)
                        .then((record) => {
                          setInstallation(record);
                          setInstalled(true);
                        })
                        .catch((cause) => setError(errorText(cause)))
                        .finally(() => setBusy(false));
                    }}
                  >
                    确认安装
                  </button>
                </>
              )}
            </>
          )}
          {error && (
            <p className="creative-error" role="alert">
              {error}
            </p>
          )}
        </aside>
      </div>
    </>
  );
}
