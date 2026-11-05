import { useCallback, useState } from "react";
import type { components } from "@generated/managementApi";
export type Command =
  | {
      kind: "application";
      action: components["schemas"]["ManagementApplicationAction"]["action"];
    }
  | {
      kind: "access";
      action: components["schemas"]["ManagementAccessAction"]["action"];
      target: "business" | "management";
    };
export type CommandReceipt = {
  requestId: string;
  command: Command;
  jobId?: string;
};
function read(key: string): CommandReceipt | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(key) || "null",
    ) as CommandReceipt | null;
    if (!value || !/^[a-f0-9-]{36}$/i.test(value.requestId)) return null;
    const command = value.command;
    if (
      command.kind === "application" &&
      ["start", "stop", "restart", "force_stop"].includes(command.action)
    )
      return value;
    if (
      command.kind === "access" &&
      ["business", "management"].includes(command.target) &&
      ["public_start", "public_stop", "check"].includes(command.action)
    )
      return value;
  } catch {
    /* Missing or invalid local receipt is never interpreted as a host command. */
  }
  return null;
}
export function useCommandReceipt(ownerId: string) {
  const key = `management-command:${ownerId}`;
  const [receipt, setReceipt] = useState(() => read(key));
  const remember = useCallback(
    (value: CommandReceipt) => {
      // Persist only the UUID and fixed action, before sending. No auth material is stored.
      sessionStorage.setItem(key, JSON.stringify(value));
      setReceipt(value);
    },
    [key],
  );
  const clear = useCallback(() => {
    sessionStorage.removeItem(key);
    setReceipt(null);
  }, [key]);
  return { receipt, remember, clear };
}
