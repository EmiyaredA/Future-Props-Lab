import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import "./cloud-control.css";

export function CloudControlAccess({ children }: { children: ReactNode }) {
  const allowed = useAccountPermission("cloud-control.access");
  if (!allowed)
    return (
      <section
        className="page cloud-control-page"
        aria-labelledby="cloud-control-denied"
      >
        <ShieldCheck aria-hidden />
        <h1 id="cloud-control-denied">云控仅限管理员访问</h1>
        <p>当前账号没有访问权限，请使用管理员账号。</p>
        <a className="btn" href="/">
          返回首页
        </a>
      </section>
    );
  return children;
}
