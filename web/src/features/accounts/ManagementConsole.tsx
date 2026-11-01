import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Menu,
  X,
  Users,
  ScrollText,
  Ticket,
  SlidersHorizontal,
  Server,
  ShieldCheck,
} from "lucide-react";
import { BrandMark } from "@shared/ui/BrandMark";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { AccountPanel } from "./AccountPanel";
import { AccountMenu } from "./AccountMenu";
import type { AccountSessionContext } from "./api";
import { ManagedAccountsPage } from "./ManagedAccountsPage";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { RegistrationInvitesPage } from "./RegistrationInvitesPage";
import { RuntimeQuotasPage } from "./RuntimeQuotasPage";
import { DemoServicesPage } from "./DemoServicesPage";
import { ModelTemplatesPage } from "./ModelTemplatesPage";
import "./governance-pages.css";
import { AuditPage } from "./AuditPage";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import "./management.css";
export type ManagementPage =
  | "management-accounts"
  | "management-audit"
  | "management-invites"
  | "management-settings"
  | "management-services"
  | "management-quotas";
export function ManagementConsole({
  page,
  session,
  navigate,
  onBack,
}: {
  page: ManagementPage;
  session: AccountSessionContext;
  navigate: (page: ManagementPage) => void;
  onBack: () => void;
}) {
  const [drawer, setDrawer] = useState(false);
  const dirty = useRef(new Set<string>());
  const [pendingNavigation, setPendingNavigation] = useState<
    (() => void) | null
  >(null);
  const guarded = (action: () => void) => {
    if (dirty.current.size) setPendingNavigation(() => action);
    else action();
  };
  useEffect(() => {
    const changed = (event: Event) => {
      const { id, dirty: changedDirty } = (
        event as CustomEvent<{ id: string; dirty: boolean }>
      ).detail;
      if (changedDirty) dirty.current.add(id);
      else dirty.current.delete(id);
    };
    const switching = (event: Event) => {
      if (!dirty.current.size) return;
      event.preventDefault();
      const action = (event as CustomEvent<() => void>).detail;
      if (typeof action === "function") setPendingNavigation(() => action);
    };
    window.addEventListener("future-props:management-draft", changed);
    const deferRefresh = (event: Event) => {
      if (dirty.current.size) event.preventDefault();
    };
    window.addEventListener(
      "future-props:development-query-refresh",
      deferRefresh,
    );
    window.addEventListener("future-props:before-navigation", switching);
    return () => {
      window.removeEventListener("future-props:management-draft", changed);
      window.removeEventListener(
        "future-props:development-query-refresh",
        deferRefresh,
      );
      window.removeEventListener("future-props:before-navigation", switching);
    };
  }, []);
  const focus = useDrawerFocus<HTMLElement>(
    () => setDrawer(false),
    drawer,
    false,
  );
  const links = [
    ["management-accounts", "账号管理", "账号身份与登录资格", Users],
    ["management-invites", "邀请码管理", "注册名额与有效期", Ticket],
    ["management-settings", "全局设置", "角色默认模型模板", SlidersHorizontal],
    ["management-services", "服务管理", "本地工具与模型测试", Server],
    ["management-quotas", "运行额度", "账号与实例并发额度", ShieldCheck],
    ["management-audit", "安全审计", "管理操作与安全记录", ScrollText],
  ] as const;
  if (!session.me.user.is_platform_admin)
    return (
      <main className="management-page">
        <h1>需要平台管理员权限</h1>
        <p>此页面用于管理平台账号、共享资源和安全审计。</p>
        <button className="btn" onClick={() => guarded(onBack)}>
          返回工作台
        </button>
      </main>
    );
  return (
    <div className="management-shell">
      {drawer ? (
        <button
          className="management-nav-backdrop"
          aria-label="关闭管理导航遮罩"
          onClick={() => setDrawer(false)}
        />
      ) : null}
      <aside
        ref={focus}
        className={`management-sidebar ${drawer ? "is-open" : ""}`}
        aria-label="管理中台导航"
      >
        <button
          className="management-mobile-close icon-button"
          aria-label="关闭管理导航"
          onClick={() => setDrawer(false)}
        >
          <X size={21} />
        </button>
        <div className="management-brand">
          <BrandMark size={40} />
          <span>
            <strong>Future Props Lab</strong>
            <small>管理中台</small>
          </span>
        </div>
        <nav aria-label="管理中台">
          {links.map(([id, label, description, Icon]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              aria-label={label}
              aria-current={page === id ? "page" : undefined}
              onClick={() => {
                setDrawer(false);
                guarded(() => navigate(id));
              }}
            >
              <span className="management-nav-icon">
                <Icon size={21} />
              </span>
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
            </button>
          ))}
        </nav>
        <footer>
          <ThemeToggle />
          <button className="management-back" onClick={() => guarded(onBack)}>
            <ArrowLeft size={19} />
            返回工作台
          </button>
        </footer>
      </aside>
      <main>
        <div className="management-topbar">
          <button
            className="management-mobile-menu btn"
            aria-label="打开管理导航"
            onClick={() => setDrawer(true)}
          >
            <Menu size={18} />
            导航
          </button>
          <span className="management-breadcrumb">
            管理中台<span>/</span>
            {links.find((l) => l[0] === page)?.[1]}
          </span>
          <AccountMenu session={session} />
        </div>
        {page === "management-accounts" ? (
          <ManagedAccountsPage userId={session.me.user.id} />
        ) : page === "management-invites" ? (
          <RegistrationInvitesPage />
        ) : page === "management-settings" ? (
          <ModelTemplatesPage />
        ) : page === "management-services" ? (
          <DemoServicesPage />
        ) : page === "management-quotas" ? (
          <RuntimeQuotasPage />
        ) : (
          <AuditPage />
        )}
      </main>
      <AccountPanel session={session} hiddenEntries />
      <ConfirmDialog
        open={!!pendingNavigation}
        title="放弃尚未保存的更改？"
        description="离开当前页面将清除草稿。"
        onCancel={() => setPendingNavigation(null)}
        onConfirm={() => {
          const action = pendingNavigation;
          setPendingNavigation(null);
          dirty.current.clear();
          action?.();
        }}
      />
    </div>
  );
}
