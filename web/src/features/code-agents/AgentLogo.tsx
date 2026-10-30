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
      <img
        src="/providers/pi-logo.svg"
        className="code-agent-logo"
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
      />
    );
  return (
    <span
      className={`code-agent-logo is-${id}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
