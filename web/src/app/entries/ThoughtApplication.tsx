import { lazy, useCallback, useEffect, useRef, useState } from "react";
import { useAccountId } from "@platform/auth/AccountAccess";
import { RuntimeAccessProvider } from "@features/accounts/RuntimeAccessProvider";
import type { KnowledgeSection } from "@features/thought-workshop/KnowledgeSections";
import type { NavigationGuard } from "@features/thought-workshop/NoteEditorPane";
import { THOUGHT_WORKSHOP_MODULE as thought } from "@features/thought-workshop/module";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { useNavigationProtection } from "@shared/ui/navigationGuards";
import { ApplicationUpdate } from "./ApplicationUpdate";
import { guardedNavigation } from "./navigation";

const ThoughtWorkshopPage = lazy(thought.pages.notes);
const Community = lazy(() =>
  import("@features/thought-workshop/community/KnowledgeCommunityPage").then(
    (module) => ({ default: module.KnowledgeCommunityPage }),
  ),
);
const Official = lazy(() =>
  import("@features/thought-workshop/community/LegacyOfficialPage").then(
    (module) => ({ default: module.LegacyOfficialPage }),
  ),
);
const sectionPages: Record<KnowledgeSection, string> = {
  private: "thought-workshop-notes",
  community: "thought-workshop-community",
  published: "thought-workshop-published",
  favorites: "thought-workshop-favorites",
};

function currentPath() {
  return location.pathname + location.search + location.hash;
}

function ThoughtContent() {
  const owner = useAccountId();
  const protection = useNavigationProtection();
  const removeGuard = useRef<(() => void) | undefined>(undefined);
  const [path, setPath] = useState(currentPath);
  const registerNavigationGuard = useCallback<NavigationGuard>(
    (guard) => {
      removeGuard.current?.();
      removeGuard.current = guard ? protection?.register(guard) : undefined;
    },
    [protection],
  );
  useEffect(() => () => removeGuard.current?.(), []);
  useEffect(() => {
    const pop = () => {
      const next = currentPath();
      const resume = () => {
        if (currentPath() !== next) history.pushState({}, "", next);
        setPath(next);
      };
      if (protection?.protect(resume)) history.pushState({}, "", path);
      else resume();
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [path, protection]);
  const navigate = (page: string, project?: string, document?: string) => {
    const next = thought.pathFor(page, project, document);
    if (!next || next === currentPath()) return;
    guardedNavigation(() => {
      history.pushState({}, "", next);
      setPath(next);
    });
  };
  const section = (value: KnowledgeSection) => navigate(sectionPages[value]);
  const back = () => guardedNavigation(() => location.assign("/apps"), true);
  const route = thought.matchPath(new URL(path, location.origin).pathname);
  if (!route)
    return (
      <section className="independent-not-found">
        <h1>页面不存在</h1>
        <a href="/apps/thought-workshop">返回思绪工坊</a>
      </section>
    );
  const { page, projectId, documentId } = route;
  const communitySection =
    page === sectionPages.community
      ? "community"
      : page === sectionPages.favorites
        ? "favorites"
        : page === sectionPages.published
          ? "published"
          : undefined;
  if (communitySection)
    return (
      <Community
        section={communitySection}
        publication={projectId}
        noteId={documentId}
        navigate={section}
        onOpen={(publication, document) =>
          navigate(sectionPages.community, publication, document)
        }
        onOpenNote={(project) => navigate("thought-workshop-editor", project)}
        onBack={back}
        registerNavigationGuard={registerNavigationGuard}
      />
    );
  if (page === "thought-workshop-official")
    return (
      <Official
        key={owner}
        libraryId={projectId}
        documentId={documentId}
        onOpen={(publication, document) =>
          navigate(sectionPages.community, publication, document)
        }
        onBack={() => section("community")}
      />
    );
  return (
    <ThoughtWorkshopPage
      key={owner}
      page={page}
      projectId={projectId}
      noteId={documentId}
      onNavigateSection={section}
      onOpenOfficial={(id) => navigate("thought-workshop-official", id)}
      onNavigate={(project, document, replace) => {
        const nextPage = project
          ? "thought-workshop-editor"
          : sectionPages.private;
        if (replace) {
          const next = thought.pathFor(nextPage, project, document);
          if (next) {
            history.replaceState({}, "", next);
            setPath(next);
          }
        } else navigate(nextPage, project, document);
      }}
      onBack={back}
      registerNavigationGuard={registerNavigationGuard}
    />
  );
}

export default function ThoughtApplication() {
  return (
    <RuntimeAccessProvider>
      <NavigationProtection>
        <ApplicationUpdate />
        <ThoughtContent />
      </NavigationProtection>
    </RuntimeAccessProvider>
  );
}
