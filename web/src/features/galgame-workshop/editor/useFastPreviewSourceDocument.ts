import { useEffect, useRef, useState } from "react";
import type { GalgameStoryProject } from "@features/galgame-workshop/api";

export function useFastPreviewSourceDocument(
  sourceDocument: GalgameStoryProject,
  storyRevision?: number,
) {
  const sourceRef = useRef(sourceDocument);
  const [document, setDocument] = useState(sourceDocument);
  const [revision, setRevision] = useState(storyRevision);
  useEffect(() => {
    setRevision(storyRevision);
    if (sourceRef.current === sourceDocument) return;
    sourceRef.current = sourceDocument;
    setDocument(sourceDocument);
  }, [sourceDocument, storyRevision]);
  return [document, setDocument, revision, setRevision] as const;
}
