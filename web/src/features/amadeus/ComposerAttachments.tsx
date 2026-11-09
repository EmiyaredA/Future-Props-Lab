import type { RefObject } from "react";

export function ComposerAttachments({
  input,
  importing,
  importFiles,
}: {
  input: RefObject<HTMLInputElement | null>;
  importing: boolean;
  importFiles: (files: File[]) => Promise<void>;
}) {
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        onChange={(event) => {
          void importFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      {importing && (
        <div className="amadeus-attachments" role="status">
          正在导入附件…
        </div>
      )}
    </>
  );
}
