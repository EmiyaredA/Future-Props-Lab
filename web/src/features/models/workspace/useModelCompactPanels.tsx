import { useState } from "react";
import { CompactPanelTabs } from "@shared/ui/CompactPanelTabs";
import "./model-compact-panels.css";

export function useModelCompactPanels(
  kind: "generation" | "transcription" | "realtime",
) {
  const [panel, setPanel] = useState("result");
  return {
    panel,
    tabs: (
      <CompactPanelTabs
        label="测试工作区面板"
        value={panel}
        onChange={setPanel}
        options={[
          {
            value: "result",
            label: kind === "realtime" ? "语音对话" : "测试结果",
          },
          { value: "settings", label: "参数与资源" },
          ...(kind === "realtime"
            ? []
            : [{ value: "history", label: "历史记录" }]),
        ]}
      />
    ),
  };
}
