import { useRef, useState, type FormEvent, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  FolderOpen,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { reauthenticate } from "@features/accounts";
import { getSetup, saveSetup, type CloudSetup } from "./cloudApi";

function SetupCheckbox({
  checked,
  disabled,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="cloud-setup-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="cloud-setup-tick" aria-hidden="true">
        <Check size={12} />
      </span>
      <span>{children}</span>
    </label>
  );
}

function SetupForm({
  initial,
  refresh,
  changed,
  enroll,
}: {
  initial: CloudSetup;
  refresh: () => Promise<void>;
  changed: () => void;
  enroll: () => void;
}) {
  const [data, setData] = useState(initial);
  const [host, setHost] = useState(initial.host_label);
  const [publicEnabled, setPublicEnabled] = useState(initial.public_enabled);
  const [projects, setProjects] = useState(initial.projects);
  const [search, setSearch] = useState("");
  const [path, setPath] = useState("");
  const [password, setPassword] = useState("");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function run(
    operation: () => Promise<CloudSetup>,
    label: string,
    reset = false,
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!verified) {
        if (!password) throw new Error("请输入 FPL 管理员密码");
        await reauthenticate(password);
        setPassword("");
        setVerified(true);
      }
      const next = await operation();
      setData(next);
      if (reset) {
        setProjects(next.projects);
        setPublicEnabled(next.public_enabled);
        setHost(next.host_label);
      }
      setMessage(label);
      changed();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void run(
      () =>
        saveSetup({
          revision: data.revision,
          host_label: host,
          public_enabled: publicEnabled,
          projects: projects
            .filter((project) => project.selected)
            .map((project) => project.root),
        }),
      "云控设置已保存",
      true,
    );
  }

  function addPath() {
    const root = path.trim();
    if (!root.startsWith("/")) {
      setError("请填写项目的绝对路径");
      return;
    }
    const existing = projects.find((project) => project.root === root);
    setProjects(
      existing
        ? projects.map((project) =>
            project.root === root ? { ...project, selected: true } : project,
          )
        : [
            ...projects,
            {
              root,
              label: root.split("/").filter(Boolean).at(-1) ?? root,
              selected: true,
            },
          ],
    );
    setPath("");
    setSearch("");
    setError("");
  }

  const filter = search.trim().toLowerCase();
  const visibleProjects = projects.filter(
    (project) =>
      project.label.toLowerCase().includes(filter) ||
      project.root.toLowerCase().includes(filter),
  );

  return (
    <form className="cloud-setup-form" onSubmit={save}>
      <div className="cloud-setup-grid">
        <section
          className="cloud-setup-section"
          aria-labelledby="cloud-setup-host"
        >
          <header className="cloud-setup-section-heading">
            <Monitor size={17} aria-hidden="true" />
            <h3 id="cloud-setup-host">桌面连接</h3>
          </header>
          <dl className="cloud-setup-readiness">
            <div>
              <dt>guacd</dt>
              <dd data-ready={data.guacd_ready}>
                {data.guacd_ready ? "就绪" : "未就绪"}
              </dd>
            </div>
            <div>
              <dt>Mac 屏幕共享</dt>
              <dd data-ready={data.screen_sharing_ready === true}>
                {data.screen_sharing_ready === null
                  ? "待验证"
                  : data.screen_sharing_ready
                    ? "就绪"
                    : "未就绪"}
              </dd>
            </div>
          </dl>
          {!data.guacd_ready && (
            <p className="cloud-setup-hint">启动本机 guacd 后刷新状态。</p>
          )}
          <label className="cloud-setup-field">
            主机显示名
            <input
              value={host}
              onChange={(event) => setHost(event.target.value)}
              maxLength={80}
              required
            />
          </label>
          {!verified ? (
            <label className="cloud-setup-field">
              FPL 管理员密码
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <small>首次保存、检测或授权时验证。</small>
            </label>
          ) : (
            <div className="cloud-setup-verified">
              <span>
                <ShieldCheck size={15} aria-hidden="true" /> 密码已验证
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => setVerified(false)}
              >
                重新验证
              </button>
            </div>
          )}
          <div className="cloud-setup-public">
            <SetupCheckbox
              checked={publicEnabled}
              disabled={
                !data.enrolled &&
                !data.public_desktop_vnc_only &&
                !publicEnabled
              }
              onChange={setPublicEnabled}
            >
              {data.public_desktop_vnc_only
                ? "允许已授权管理员从公网连接桌面"
                : "允许已授权管理员从公网连接"}
            </SetupCheckbox>
            {data.public_desktop_vnc_only ? (
              <p className="cloud-setup-hint">
                公网桌面使用 FPL 管理员登录和 VNC 密码。Agent 执行仅限本机。
              </p>
            ) : (
              !data.enrolled && (
                <p className="cloud-setup-hint">
                  {data.enabled
                    ? "开启公网前需登记验证器。"
                    : "启用云控后可登记验证器。"}
                </p>
              )
            )}
            {data.enabled &&
              !data.enrolled &&
              !data.public_desktop_vnc_only && (
                <button type="button" className="btn" onClick={enroll}>
                  登记验证器
                </button>
              )}
          </div>
        </section>

        <section
          className="cloud-setup-section"
          aria-labelledby="cloud-setup-projects"
        >
          <header className="cloud-setup-section-heading">
            <FolderOpen size={17} aria-hidden="true" />
            <h3 id="cloud-setup-projects">项目授权</h3>
            <span className="cloud-setup-count">
              已选 {projects.filter((project) => project.selected).length} 项
            </span>
          </header>
          <div className="cloud-setup-search">
            <Search size={15} aria-hidden="true" />
            <input
              aria-label="搜索项目"
              placeholder="搜索项目名称或路径"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing)
                  event.preventDefault();
              }}
            />
          </div>
          <div className="cloud-setup-list">
            {visibleProjects.map((project) => (
              <SetupCheckbox
                key={project.root}
                checked={project.selected}
                onChange={(selected) =>
                  setProjects((items) =>
                    items.map((item) =>
                      item.root === project.root ? { ...item, selected } : item,
                    ),
                  )
                }
              >
                <strong>{project.label}</strong>
                <small>{project.root}</small>
              </SetupCheckbox>
            ))}
            {visibleProjects.length === 0 && (
              <p className="cloud-setup-hint">
                {filter ? "没有匹配的项目" : "暂无可选项目"}
              </p>
            )}
          </div>
          <div className="cloud-setup-path">
            <input
              aria-label="项目绝对路径"
              placeholder="粘贴项目绝对路径"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  addPath();
                }
              }}
            />
            <button
              type="button"
              className="btn"
              disabled={!path.trim()}
              onClick={addPath}
            >
              <Plus size={14} aria-hidden="true" /> 添加
            </button>
          </div>
        </section>
      </div>
      <footer className="cloud-setup-footer">
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <button
          type="button"
          className="btn cloud-setup-refresh"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} aria-hidden="true" /> 刷新状态
        </button>
        <div className="cloud-setup-actions">
          <Dialog.Close asChild>
            <button type="button" className="btn">
              关闭
            </button>
          </Dialog.Close>
          <button className="btn cloud-primary" type="submit" disabled={busy}>
            {data.enabled ? "保存设置" : "启用云控"}
          </button>
        </div>
      </footer>
    </form>
  );
}

export function CloudSetupDialog({
  owner,
  close,
  changed,
  enroll,
}: {
  owner: string;
  close: () => void;
  changed: () => void;
  enroll: () => void;
}) {
  const [epoch, setEpoch] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);
  const setup = useQuery({
    queryKey: ["cloud-control", owner, "setup"],
    queryFn: ({ signal }) => getSetup(signal),
    staleTime: 0,
  });
  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="cloud-dialog-overlay" />
        <Dialog.Content
          className="cloud-dialog cloud-setup-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            title.current?.focus();
          }}
        >
          <header className="cloud-setup-header">
            <div>
              <Dialog.Title ref={title} tabIndex={-1}>
                云控设置
              </Dialog.Title>
              <Dialog.Description>
                管理这台 Mac 的远程桌面和可供工作台使用的项目
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="btn cloud-setup-dismiss"
                aria-label="关闭云控设置"
              >
                <X size={19} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </header>
          {setup.data ? (
            <SetupForm
              key={epoch}
              initial={setup.data}
              changed={changed}
              enroll={enroll}
              refresh={async () => {
                const result = await setup.refetch();
                if (result.isSuccess) setEpoch((value) => value + 1);
              }}
            />
          ) : (
            <p
              className="cloud-setup-empty"
              role={setup.error ? "alert" : "status"}
            >
              {setup.error?.message ?? "正在读取本机配置…"}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
