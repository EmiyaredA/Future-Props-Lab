import * as Tabs from "@radix-ui/react-tabs";
import { PanelsTopLeft, FileText, Box } from "lucide-react";
import "./creative-tools.css";

export type ProjectWorkspace = "workbench" | "script" | "previs";
export type WorkbenchView = "canvas" | "board";
export type CreativeTool = "script" | "storyboard" | "previs";
export type CreativeToolActions = {
  onWorkbench?: () => void;
  onScript?: () => void;
  onStoryboard?: () => void;
  onPrevis?: () => void;
};

export function ProjectCreativeTools({
  onWorkbench,
  onScript,
  onPrevis,
  active = "workbench",
  disabled = false,
}: CreativeToolActions & {
  active?: ProjectWorkspace | CreativeTool;
  disabled?: boolean;
}) {
  const actions = {
    workbench: onWorkbench,
    script: onScript,
    previs: onPrevis,
  };
  return (
    <Tabs.Root
      className="project-creative-tools"
      value={active === "storyboard" ? "workbench" : active}
      activationMode="manual"
      onValueChange={(value) => actions[value as ProjectWorkspace]?.()}
    >
      <Tabs.List aria-label="项目工作区">
        {(
          [
            ["workbench", "工作台", PanelsTopLeft],
            ["script", "剧本", FileText],
            ["previs", "白模预演", Box],
          ] as const
        ).map(([key, label, Icon]) => (
          <Tabs.Trigger
            key={key}
            value={key}
            disabled={disabled || !actions[key]}
          >
            <Icon size={16} aria-hidden />
            <span>{label}</span>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
