import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { JSONContent } from "@tiptap/core";
const Scope = createContext<{
  libraryId: string;
  official: boolean;
  cardIds: string[];
  navigate?: (href: string) => void;
}>({
  libraryId: "",
  official: false,
  cardIds: [] as string[],
});
export function NavigationScope({
  libraryId,
  official = false,
  children,
  document,
  navigate,
}: {
  libraryId: string;
  official?: boolean;
  children: ReactNode;
  document?: JSONContent;
  navigate?: (href: string) => void;
}) {
  const cardIds = useMemo(() => {
    const ids = new Set<string>();
    const walk = (node: JSONContent) => {
      if (
        node.type === "documentCard" &&
        node.attrs?.kind === "note" &&
        node.attrs.noteId
      )
        ids.add(node.attrs.noteId);
      node.content?.forEach(walk);
    };
    if (document) walk(document);
    return [...ids].sort();
  }, [document]);
  return (
    <Scope.Provider value={{ libraryId, official, cardIds, navigate }}>
      {children}
    </Scope.Provider>
  );
}
// NodeViews consume the explicitly bound document scope.
// eslint-disable-next-line react-refresh/only-export-components
export const useNavigationScope = () => useContext(Scope);
