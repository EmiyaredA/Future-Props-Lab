import type { Agent } from "./api";

export function AgentLogo({
  id,
  size = 18,
}: {
  id: Agent["id"];
  size?: number;
}) {
  return (
    <span
      className={`code-agent-logo is-${id}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
