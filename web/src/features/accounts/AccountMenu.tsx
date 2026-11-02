import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { useRuntimeAccess } from "./useRuntimeAccess";
import { lazy, Suspense } from "react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Globe,
  ChevronDown,
  LogOut,
  Settings,
  ShieldCheck,
} from "lucide-react";
import type { AccountSessionContext } from "./api";
import { avatarSrc } from "./avatarSrc";
import "./account-navigation.css";

const WebsiteAccessDialog = lazy(() => import("./WebsiteAccessDialog"));

export function AccountActionMenu({
  label,
  trigger,
  identity,
  items,
}: {
  label: string;
  trigger: ReactNode;
  identity?: ReactNode;
  items: {
    label: string;
    icon?: ReactNode;
    disabled?: boolean;
    danger?: boolean;
    action: () => void;
  }[];
}) {
  const [position, setPosition] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (restore = false) => {
    setPosition(null);
    if (restore) button.current?.focus();
  };
  useEffect(() => {
    if (!position) return;
    menu.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    const outside = (e: PointerEvent) => {
      if (
        !menu.current?.contains(e.target as Node) &&
        !button.current?.contains(e.target as Node)
      )
        setPosition(null);
    };
    const reposition = () => setPosition(null);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", reposition);
    };
  }, [position]);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="account-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={!!position}
        aria-controls={position ? id : undefined}
        onClick={() => {
          const rect = button.current!.getBoundingClientRect();
          if (position) close();
          else
            setPosition({
              top: Math.min(rect.bottom + 8, window.innerHeight - 310),
              right: Math.max(12, window.innerWidth - rect.right),
            });
        }}
      >
        {trigger}
      </button>
      {position
        ? createPortal(
            <div
              ref={menu}
              id={id}
              className="account-popover"
              role="menu"
              aria-label={label}
              style={{ top: Math.max(12, position.top), right: position.right }}
              onBlur={(e) => {
                if (
                  e.relatedTarget &&
                  !e.currentTarget.contains(e.relatedTarget)
                )
                  close();
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  close(true);
                }
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key))
                  return;
                e.preventDefault();
                const buttons = Array.from(
                  e.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button:not(:disabled)",
                  ),
                );
                const index = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? buttons.length - 1
                      : (index +
                          (e.key === "ArrowUp" ? -1 : 1) +
                          buttons.length) %
                        buttons.length;
                buttons[next]?.focus();
              }}
            >
              {identity ? (
                <div className="account-popover-identity">{identity}</div>
              ) : null}
              {items.map((item) => (
                <button
                  key={item.label}
                  role="menuitem"
                  type="button"
                  disabled={item.disabled}
                  className={item.danger ? "is-danger" : undefined}
                  onClick={() => {
                    close(true);
                    item.action();
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function AccountMenu({ session }: { session: AccountSessionContext }) {
  const { me } = session;
  const [error, setError] = useState("");
  const localBrowser = useRuntimeAccess();
  const [accessOpen, setAccessOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const avatar = (
    <span className="account-identity-avatar">
      {me.user.avatar_url ? (
        <ResponsiveImage
          src={avatarSrc(me.user.avatar_url, me.user.revision)}
          alt=""
        />
      ) : (
        me.user.display_name.slice(0, 1)
      )}
    </span>
  );
  return (
    <div className="account-menu">
      <AccountActionMenu
        label="账号菜单"
        trigger={
          <>
            {avatar}
            <strong>{me.user.display_name}</strong>
            <ChevronDown size={15} />
          </>
        }
        identity={
          <>
            {avatar}
            <span>
              <strong>{me.user.display_name}</strong>
              <small>{me.user.display_name}</small>
            </span>
          </>
        }
        items={[
          ...(localBrowser && me.user.is_platform_admin
            ? [
                {
                  label: "本地与公网访问",
                  icon: <Globe size={18} />,
                  action: () => setAccessOpen(true),
                },
              ]
            : []),
          {
            label: "账号设置",
            icon: <Settings size={18} />,
            action: () =>
              window.dispatchEvent(new Event("future-props:open-account")),
          },
          ...(me.user.is_platform_admin
            ? [
                {
                  label: "管理中台",
                  icon: <ShieldCheck size={18} />,
                  action: () =>
                    window.dispatchEvent(
                      new CustomEvent("future-props:navigate", {
                        detail: "/management/accounts",
                      }),
                    ),
                },
              ]
            : []),
          {
            label: pending ? "正在退出…" : "退出登录",
            icon: <LogOut size={18} />,
            disabled: pending,
            danger: true,
            action: () => {
              setPending(true);
              setError("");
              void session.logout().catch((e: unknown) => {
                setError(e instanceof Error ? e.message : "退出失败，请重试");
                setPending(false);
              });
            },
          },
        ]}
      />
      {accessOpen && (
        <Suspense fallback={null}>
          <WebsiteAccessDialog onClose={() => setAccessOpen(false)} />
        </Suspense>
      )}
      {error ? (
        <p className="account-menu-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
