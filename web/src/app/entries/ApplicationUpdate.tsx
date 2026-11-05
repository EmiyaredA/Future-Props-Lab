import { useEffect, useState } from "react";
import { recoverPage } from "@app/recovery";

export function ApplicationUpdate() {
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    const update = (event: Event) => {
      if (
        (event as CustomEvent<string>).detail ===
        import.meta.env.VITE_FPL_SERVICE
      )
        setChanged(true);
    };
    window.addEventListener("future-props:application-update", update);
    return () =>
      window.removeEventListener("future-props:application-update", update);
  }, []);
  if (!changed) return null;
  return (
    <aside className="independent-update" role="alert">
      <span>此应用已更新。请保留尚未提交的内容后重新加载。</span>
      <button className="btn small" onClick={() => recoverPage()}>
        重新加载
      </button>
    </aside>
  );
}
