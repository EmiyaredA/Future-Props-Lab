import { useState } from "react";
import { useAccountId } from "@platform/auth/WorkspacePermissions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CommunityPage } from "./CommunityPage";
import { CommunityReader } from "./CommunityReader";
import { PublicationDialog } from "./PublicationDialog";
import { getCommunityManagement, type Publication } from "./api";
import type { KnowledgeSection } from "../KnowledgeSections";
import type { NavigationGuard } from "../NoteEditorPane";
import { thoughtKeys } from "../queryKeys";
export function KnowledgeCommunityPage({
  section,
  publication,
  noteId,
  navigate,
  onOpen,
  onOpenNote,
  onBack,
  registerNavigationGuard,
}: {
  section: KnowledgeSection;
  publication?: string;
  noteId?: string;
  navigate: (s: KnowledgeSection) => void;
  onOpen: (publication: string, note?: string) => void;
  onOpenNote: (id: string) => void;
  onBack: () => void;
  registerNavigationGuard: NavigationGuard;
}) {
  const user = useAccountId() ?? "";
  const [managing, setManaging] = useState<Publication | null>(null);
  const client = useQueryClient();
  const management = useQuery({
    queryKey: thoughtKeys.publicationConfig(user, managing?.id ?? ""),
    queryFn: () => getCommunityManagement(managing!.id),
    enabled: !!managing,
    retry: false,
  });
  return (
    <>
      {publication ? (
        <CommunityReader
          key={publication}
          publication={publication}
          noteId={noteId}
          navigate={navigate}
          onOpen={(note) => onOpen(publication, note)}
          registerNavigationGuard={registerNavigationGuard}
        />
      ) : (
        <CommunityPage
          section={section}
          navigate={navigate}
          onOpen={(id) => onOpen(id)}
          onImported={onOpenNote}
          onBack={onBack}
          onManage={setManaging}
        />
      )}
      {managing && management.isPending && (
        <p className="knowledge-notice" role="status">
          正在加载发布设置…
        </p>
      )}
      {managing && management.isError && (
        <p role="alert">
          {management.error.message}
          <button className="btn" onClick={() => setManaging(null)}>
            关闭
          </button>
        </p>
      )}
      {managing && management.data && (
        <PublicationDialog
          directory={management.data.directory}
          publicationId={managing.id}
          close={() => setManaging(null)}
          saved={() => {
            setManaging(null);
            void client.invalidateQueries({ queryKey: thoughtKeys.all });
          }}
        />
      )}
    </>
  );
}
