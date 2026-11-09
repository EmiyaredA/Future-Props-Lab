import { useEffect, useState } from "react";
import { recoverPage } from "@app/recovery";

export function ApplicationUpdate() {
  const [changed, setChanged] = useState<"available" | "required">();
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (
        event as CustomEvent<{ service: string; required: boolean }>
      ).detail;
      if (detail.service === import.meta.env.VITE_FPL_SERVICE)
        setChanged((previous) =>
          detail.required || previous === "required" ? "required" : "available",
        );
    };
    window.addEventListener("future-props:application-update", update);
    return () =>
      window.removeEventListener("future-props:application-update", update);
  }, []);
  if (!changed) return null;
  return (
    <aside className="independent-update" role="status">
      <span>
        {changed === "required"
          ? "此应用需要更新后才能提交。Amadeus 对话和草稿会保留。"
          : "新版已就绪。你可以继续当前工作，方便时再更新。"}
      </span>
      <button className="btn small" onClick={() => recoverPage()}>
        重新加载
      </button>
    </aside>
  );
}
