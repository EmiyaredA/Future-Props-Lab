import {
  previewIdentity,
  previewDraft,
  type PreviewDraft,
  type PreviewIdentity,
  type PreviewStatus,
} from "./pet-preview-protocol";

type Owner = Pick<
  Electron.WebContents,
  "id" | "send" | "once" | "removeListener" | "isDestroyed"
>;
/** A bounded, expiring in-memory lease. It never persists or resolves asset URLs. */
export class PetPreviewRelay {
  private session:
    | (PreviewIdentity & {
        owner: Owner;
        draft: PreviewDraft | null;
        sequence: number;
        release: () => void;
      })
    | null = null;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private paused = false;
  private status: PreviewStatus = {
    sessionId: null,
    state: "idle",
    message: "",
  };
  constructor(
    private readonly deliver: (
      value: { draft: PreviewDraft; paused: boolean } | null,
    ) => void,
  ) {}
  private notify(state: PreviewStatus["state"], message: string) {
    this.status = {
      sessionId: this.session?.sessionId ?? null,
      state,
      message,
    };
    if (this.session && !this.session.owner.isDestroyed())
      this.session.owner.send("desktop:pet-preview-status", this.status);
    return this.status;
  }
  private renew() {
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = setTimeout(
      () => this.end("联动已断开，桌宠恢复正常运行"),
      6500,
    );
    this.expiry.unref();
  }
  begin(owner: Owner, value: unknown) {
    const identity = previewIdentity(value);
    if (this.session) throw new Error("另一编辑窗口已占用桌宠联动");
    const release = () => this.end("编辑窗口已离开，桌宠恢复正常运行");
    this.session = { ...identity, owner, draft: null, sequence: -1, release };
    owner.once("destroyed", release);
    owner.once("render-process-gone", release);
    owner.once("did-start-navigation", release);
    this.renew();
    return this.notify(
      this.paused ? "paused" : "active",
      this.paused ? "聊天中，联动已暂停" : "临时预览，尚未保存",
    );
  }
  update(owner: Owner, value: unknown) {
    const draft = previewDraft(value);
    const session = this.session;
    if (
      !session ||
      session.owner.id !== owner.id ||
      session.sessionId !== draft.sessionId ||
      session.projectId !== draft.projectId
    )
      throw new Error("预览会话已失效");
    if (
      draft.sequence <= session.sequence ||
      draft.baseRevision < session.baseRevision
    )
      throw new Error("预览更新已过期");
    session.sequence = draft.sequence;
    session.baseRevision = draft.baseRevision;
    session.draft = draft;
    this.renew();
    this.deliver({ draft, paused: this.paused });
    return this.status;
  }
  endByOwner(ownerId: number, sessionId?: unknown) {
    if (
      this.session?.owner.id === ownerId &&
      (sessionId === undefined || sessionId === this.session.sessionId)
    )
      this.end();
  }
  end(message = "桌宠已恢复正常运行") {
    const session = this.session;
    if (!session) return;
    this.notify("idle", message);
    session.owner.removeListener("destroyed", session.release);
    session.owner.removeListener("render-process-gone", session.release);
    session.owner.removeListener("did-start-navigation", session.release);
    this.session = null;
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = null;
    this.status = { sessionId: null, state: "idle", message };
    this.deliver(null);
  }
  pause(value: boolean) {
    this.paused = value;
    if (!this.session) return;
    this.notify(
      value ? "paused" : "active",
      value ? "聊天中，联动已暂停" : "临时预览，尚未保存",
    );
    if (this.session.draft)
      this.deliver({ draft: this.session.draft, paused: value });
  }
  report(value: unknown) {
    const item = value as {
      sessionId?: unknown;
      sequence?: unknown;
      message?: unknown;
      state?: unknown;
    } | null;
    if (
      !item ||
      item.sessionId !== this.session?.sessionId ||
      item.sequence !== this.session?.sequence
    )
      return;
    if (
      item.state === "error" &&
      typeof item.message === "string" &&
      item.message.length <= 200
    ) {
      this.notify("error", item.message);
      this.end(item.message);
    }
  }
  current() {
    return this.session?.draft
      ? { draft: this.session.draft, paused: this.paused }
      : null;
  }
}
