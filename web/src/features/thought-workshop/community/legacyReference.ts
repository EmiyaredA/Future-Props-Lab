import { useQuery } from "@tanstack/react-query";
import { useAccountId } from "@platform/auth/WorkspacePermissions";
import { thoughtKeys } from "../queryKeys";
import { resolveOfficialLink } from "./api";
export function officialPath(library: string, document?: string) {
  return `/apps/thought-workshop/official-knowledge-bases/${encodeURIComponent(library)}${document ? `/documents/${encodeURIComponent(document)}` : ""}`;
}
export function useLegacyReference(
  kind: string,
  library?: string | null,
  document?: string | null,
) {
  const user = useAccountId() ?? "";
  const query = useQuery({
    queryKey: thoughtKeys.officialLink(user, library ?? "", document ?? ""),
    queryFn: () => resolveOfficialLink(library ?? "", document ?? ""),
    enabled: kind === "official" && !!library,
    retry: false,
  });
  const target = query.data?.length === 1 ? query.data[0] : undefined;
  return target
    ? {
        title: target.title,
        summary: target.excerpt,
        href: `/apps/thought-workshop/community/${target.publication.id}/documents/${target.note_id}`,
      }
    : query.data && query.data.length > 1
      ? {
          title: "选择官方发布",
          summary: "此旧链接对应多个可访问的官方发布。",
          href: officialPath(library!, document ?? undefined),
        }
      : undefined;
}
