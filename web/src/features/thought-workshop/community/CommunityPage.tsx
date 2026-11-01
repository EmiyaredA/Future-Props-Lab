import { openAmadeus } from "@platform/assistant";
import { useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { BookOpen, Compass, FileCode2, Star, Sparkles } from "lucide-react";
import {
  useAccountId,
  useAccountPermission,
} from "@platform/auth/AccountAccess";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { KnowledgeSidebar } from "../KnowledgeSidebar";
import { KnowledgeSections, type KnowledgeSection } from "../KnowledgeSections";
import { KnowledgeActionMenu } from "../KnowledgeActionMenu";
import { OfficialImportDialog } from "./OfficialImportDialog";
import { getOfficialImportPreview } from "./api";
import { thoughtKeys } from "../queryKeys";
import {
  listPublications,
  listFavorites,
  setFavorite,
  type Publication,
} from "./api";
import "../thought-workshop.css";
import "../knowledge.css";
import "./community.css";
function Cover({ publication }: { publication: Publication }) {
  const { url } = useApiBlobUrl(publication.cover_url);
  return (
    <div className="community-book-cover">
      {url ? (
        <img src={url} alt="" />
      ) : (
        <>
          <BookOpen size={30} />
          <span>KNOWLEDGE</span>
        </>
      )}
    </div>
  );
}
export function CommunityPage({
  section,
  navigate,
  onOpen,
  onImported,
  onBack,
  onManage,
}: {
  section: KnowledgeSection;
  navigate: (section: KnowledgeSection) => void;
  onOpen: (id: string) => void;
  onImported: (id: string) => void;
  onBack: () => void;
  onManage: (publication: Publication) => void;
}) {
  const user = useAccountId() ?? "",
    client = useQueryClient();
  const workspace = useAccountId() ?? "";
  const canWriteAccount = useAccountPermission("content.write");
  const seed = useQuery({
    queryKey: thoughtKeys.officialImport(user, workspace),
    queryFn: getOfficialImportPreview,
    enabled: canWriteAccount,
    retry: false,
  });
  const [importing, setImporting] = useState(false);
  const canReadAccount = useAccountPermission("content.read");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [drawer, setDrawer] = useState(false),
    [error, setError] = useState("");
  const sidebar = useDrawerFocus(() => setDrawer(false), drawer);
  const favorites = useQuery({
    queryKey: thoughtKeys.communityFavorites(user),
    queryFn: listFavorites,
    retry: false,
  });
  const published = useInfiniteQuery({
    queryKey: thoughtKeys.communityList(user, { query, section, filter }),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      listPublications(
        query,
        section === "published",
        section === "favorites",
        pageParam,
        signal,
        filter === "all" ? undefined : filter === "official",
      ),
    getNextPageParam: (page, pages) =>
      page.length === 24
        ? pages.reduce((sum, p) => sum + p.length, 0)
        : undefined,
    retry: false,
  });
  const favoriteIds = new Set(favorites.data?.resource_ids ?? []);
  const toggle = async (id: string, favorite: boolean) => {
    setError("");
    try {
      await setFavorite(id, !favorite);
      await client.invalidateQueries({ queryKey: thoughtKeys.community(user) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "收藏失败");
    }
  };
  const title =
    section === "published"
      ? "我的发布"
      : section === "favorites"
        ? "我的收藏"
        : "知识社区";
  return (
    <div className="thought-shell knowledge-shell community-shell">
      {drawer && (
        <button
          className="knowledge-backdrop"
          aria-label="关闭目录遮罩"
          onClick={() => setDrawer(false)}
        />
      )}
      <KnowledgeSidebar
        sidebarRef={sidebar}
        drawer={drawer}
        close={() => setDrawer(false)}
        onBack={onBack}
        onNavigate={() => navigate("private")}
        inside={false}
        query=""
        search={() => {}}
        view="all"
        browsing={false}
        home={() => {}}
        selectView={() => {}}
        trash={false}
        selectTrash={() => {}}
        content={<KnowledgeSections active={section} navigate={navigate} />}
      >
        {null}
      </KnowledgeSidebar>
      <main className="knowledge-main">
        <header className="knowledge-topbar is-library">
          <button
            className="btn knowledge-mobile"
            onClick={() => setDrawer(true)}
          >
            导航
          </button>
          <div className="knowledge-topbar-copy">
            <h1>{title}</h1>
            <p>发现文档，分享知识，让想法继续生长。</p>
          </div>
          <div className="knowledge-top-actions">
            {
              <button
                className="btn"
                aria-label="打开 Amadeus"
                onClick={() => void openAmadeus()}
              >
                <Sparkles size={16} aria-hidden /> Amadeus
              </button>
            }
            {seed.data && (
              <button className="btn" onClick={() => setImporting(true)}>
                导入现有官方文档
              </button>
            )}
            {canReadAccount && (
              <button className="btn" onClick={() => navigate("private")}>
                管理我的知识库
              </button>
            )}
          </div>
        </header>
        <div className="community-content">
          {section === "community" && (
            <section className="community-intro">
              <Compass size={44} />
              <div>
                <h2>从一篇文档，连接更多想法</h2>
                <p>
                  官方指南与社区知识库在这里相遇。阅读、收藏，或邀请伙伴共同完善文章。
                </p>
              </div>
            </section>
          )}
          <div className="community-toolbar">
            <div
              className="community-tabs"
              role="group"
              aria-label="社区内容来源"
            >
              {[
                ["all", "全部"],
                ["official", "官方文档"],
                ["users", "用户发布"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="knowledge-search">
              <input
                aria-label="搜索知识社区"
                placeholder="搜索知识库与文章…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          {(error || published.error) && (
            <p role="alert" className="thought-error">
              {error || published.error?.message}
              <button className="btn" onClick={() => void published.refetch()}>
                重试
              </button>
            </p>
          )}
          <div className="community-books">
            {published.data?.pages.flat().map((pub) => (
              <article className="community-book" key={pub.id}>
                <Cover publication={pub} />
                <div className="community-book-copy">
                  <div className="community-book-meta">
                    {pub.is_official && (
                      <span className="official-badge">官方</span>
                    )}
                    {pub.read_only && <span>只读发布 · 授权者可编辑</span>}
                    <span>{pub.active ? "社区发布" : "已撤回"}</span>
                    <span>{pub.document_count} 篇可访问文章</span>
                  </div>
                  <h3>{pub.title}</h3>
                  <p>{pub.description || "这个知识库暂时没有简介。"}</p>
                  <div className="community-book-meta">
                    <span>{pub.author}</span>
                    <time>{new Date(pub.updated_at).toLocaleDateString()}</time>
                  </div>
                  <div className="community-book-actions">
                    {pub.active && (
                      <button className="btn" onClick={() => onOpen(pub.id)}>
                        进入知识库
                      </button>
                    )}
                    {pub.can_manage_library && (
                      <KnowledgeActionMenu
                        ariaLabel={`${pub.title} 更多操作`}
                        groups={[
                          [
                            {
                              value: "manage",
                              label: "管理发布",
                              icon: FileCode2,
                            },
                          ],
                        ]}
                        onAction={() => onManage(pub)}
                      />
                    )}
                    <button
                      className="btn community-star"
                      aria-label={`收藏 ${pub.title}`}
                      aria-pressed={
                        pub.favorite || favoriteIds.has(`community/${pub.id}`)
                      }
                      disabled={!pub.active}
                      onClick={() =>
                        void toggle(
                          `community/${pub.id}`,
                          pub.favorite ||
                            favoriteIds.has(`community/${pub.id}`),
                        )
                      }
                    >
                      <Star size={16} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {published.isPending && <p role="status">正在加载用户发布…</p>}
          {published.hasNextPage && (
            <button
              className="btn community-load-more"
              disabled={published.isFetchingNextPage}
              onClick={() => void published.fetchNextPage()}
            >
              加载更多
            </button>
          )}
          {!published.isPending && !published.data?.pages.flat().length && (
            <p role="status">暂无可访问的知识库。</p>
          )}
          {importing && seed.data && (
            <OfficialImportDialog
              preview={seed.data}
              close={() => setImporting(false)}
              imported={onImported}
            />
          )}
        </div>
      </main>
    </div>
  );
}
