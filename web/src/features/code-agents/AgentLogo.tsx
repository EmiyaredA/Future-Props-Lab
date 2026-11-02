import { programAsset } from "@platform/programAsset";
import type { CSSProperties } from "react";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import type { Agent } from "./api";
import "./agent-logo.css";

export function AgentLogo({
  id,
  size = 18,
}: {
  id: Agent["id"];
  size?: number;
}) {
  if (id === "pi")
    return (
      <ResponsiveImage
        src={programAsset("/providers/pi-logo.svg")}
        className="code-agent-logo"
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
      />
    );
  const marks = {
    codex: "codex",
    "claude-code": "claudecode",
    opencode: "opencode",
    dsh: "deepseek",
  } as const;
  return (
    <span
      className={`code-agent-logo is-${id}`}
      style={
        {
          width: size,
          height: size,
          "--agent-mark": `url("${programAsset("/providers/" + marks[id] + "-logo.svg")}")`,
        } as CSSProperties
      }
      aria-hidden="true"
    />
  );
}
