// Adapted from Sayflow shared/docs; see README.md in this directory.
import type { ReactNode } from "react";
export function FeatureIcon({ kind }: { kind: string }) {
  const common = {
    className: "card-icon",
    width: 28,
    height: 28,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  const paths: Record<string, ReactNode> = {
    bot: (
      <>
        <rect x="5" y="3.5" width="14" height="12" rx="2.5" />
        <path d="M12 15.5v2.5M8.5 20.5h7" />
        <circle cx="9.5" cy="9" r="1" />
        <circle cx="14.5" cy="9" r="1" />
      </>
    ),
    knowledge: (
      <>
        <path d="M4.5 5.5v13M4.5 5.5c2.2-1.2 4.3-1.2 6.5 0v13c-2.2-1.2-4.3-1.2-6.5 0M11 5.5c2.2-1.2 4.3-1.2 6.5 0v13c-2.2-1.2-4.3-1.2-6.5 0" />
      </>
    ),
    tools: (
      <>
        <path d="M14.5 5.5a3.5 3.5 0 0 0 4 4L12 16l-4 1 1-4 6.5-7.5zM12.5 7.5l4 4" />
      </>
    ),
    key: (
      <>
        <circle cx="8" cy="12" r="4" />
        <path d="M12 12h8M17 12v3M14.5 12v2" />
      </>
    ),
    deploy: (
      <>
        <path d="M12 3.5 4.5 7.5v9L12 20.5l7.5-4v-9L12 3.5zM4.5 7.5 12 11.5l7.5-4M12 11.5v9" />
      </>
    ),
    chat: (
      <path d="M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H10l-4 3v-3H5A1.5 1.5 0 0 1 3.5 15v-7A1.5 1.5 0 0 1 5 6.5z" />
    ),
    assistant: (
      <>
        <rect x="3.5" y="4.5" width="17" height="12" rx="2" />
        <path d="M8 20.5h8M12 16.5v4M8 9.5h3M8 12.5h5" />
      </>
    ),
    handoff: (
      <path d="M8 8.5V6a2.5 2.5 0 0 1 5 0v6M13 8.5V7a2 2 0 0 1 4 0v7.5a4.5 4.5 0 0 1-4.5 4.5H10A4.5 4.5 0 0 1 5.5 14.5V11a2 2 0 0 1 4 0v1.5" />
    ),
    ops: <path d="M4.5 18.5h15M7 18.5V10M12 18.5V5.5M17 18.5v-5" />,
    check: (
      <>
        <circle cx="12" cy="12" r="8.25" />
        <path d="m8.5 12.2 2.3 2.3 4.7-5" />
      </>
    ),
  };
  return <svg {...common}>{paths[kind] || paths.check}</svg>;
}
