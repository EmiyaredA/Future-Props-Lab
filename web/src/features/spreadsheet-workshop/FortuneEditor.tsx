import { useCallback, useEffect, useRef, useState } from "react";
import { Workbook, type WorkbookInstance } from "@fortune-sheet/react";
import { defaultSettings } from "@fortune-sheet/core";
import type { Document } from "./api";
import { nativeSheets, snapshot } from "./codec";

const toolbarItems = defaultSettings.toolbarItems.filter(
  (item) => !["image", "screenshot"].includes(item),
);
const generateSheetId = () => crypto.randomUUID();

export function FortuneEditor({
  document,
  readOnly,
  onChange,
  onReady,
}: {
  document: Document;
  readOnly: boolean;
  onChange: (document: Document) => void;
  onReady: (instance: WorkbookInstance) => void;
}) {
  const [data] = useState(() => nativeSheets(document));
  const ref = useRef<WorkbookInstance>(null);
  const initialized = useRef(false);
  const change = useRef(onChange);
  change.current = onChange;
  const ready = useRef(onReady);
  ready.current = onReady;
  const handleChange = useCallback(
    (sheets: Parameters<typeof snapshot>[0]) => {
      if (initialized.current && !readOnly) change.current(snapshot(sheets));
    },
    [readOnly],
  );
  useEffect(() => {
    // The vendor initializes its workbook in an effect. Wait for that commit before reading it.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (!ref.current) return;
        ref.current.calculateFormula();
        frame = requestAnimationFrame(() => {
          if (!ref.current) return;
          initialized.current = true;
          ready.current(ref.current);
        });
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      initialized.current = false;
    };
  }, []);
  return (
    <div className="spreadsheet-grid" aria-label="电子表格编辑区">
      <Workbook
        ref={ref}
        data={data}
        lang="zh"
        allowEdit={!readOnly}
        forceCalculation={true}
        generateSheetId={generateSheetId}
        toolbarItems={toolbarItems}
        onChange={handleChange}
      />
    </div>
  );
}
