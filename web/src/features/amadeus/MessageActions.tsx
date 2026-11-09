import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  CheckSquare,
  Copy,
  GitFork,
  MoreHorizontal,
  Pin,
  PinOff,
  Square,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { ActionIcon } from "./ActionIcon";
import type { ChatMessage } from "./protocol";
import type { MessageActions } from "./useMessageActions";

export function MessageActionRow({
  message,
  actions,
}: {
  message: ChatMessage;
  actions: MessageActions;
}) {
  const [revealed, setRevealed] = useState(false);
  const id = useId();
  const selected = actions.selected.some(({ id }) => id === message.id);
  const choosing = actions.selected.length > 0;
  return (
    <div
      className="amadeus-message-action-row"
      data-visible={revealed || choosing || !!message.pinned}
      onKeyDown={(event) => {
        if (event.key === "Escape" && (revealed || choosing)) {
          event.preventDefault();
          if (choosing) actions.select([]);
          setRevealed(false);
        }
      }}
    >
      <ActionIcon
        label="消息操作"
        className="amadeus-message-more"
        aria-expanded={revealed}
        aria-controls={id}
        onClick={() => setRevealed(!revealed)}
      >
        <MoreHorizontal size={16} aria-hidden />
      </ActionIcon>
      <div className="amadeus-message-action-buttons" id={id}>
        {actions.canPin && (
          <ActionIcon
            label={message.pinned ? "取消置顶消息" : "置顶消息"}
            aria-pressed={!!message.pinned}
            disabled={!!actions.pendingPin}
            onClick={() => void actions.pin(message)}
          >
            {message.pinned ? (
              <PinOff size={15} aria-hidden />
            ) : (
              <Pin size={15} aria-hidden />
            )}
          </ActionIcon>
        )}
        {actions.canFork && (
          <ActionIcon
            label="从此消息分叉"
            disabled={actions.busy || actions.pendingFork}
            onClick={() => actions.askFork(message.id)}
          >
            <GitFork size={15} aria-hidden />
          </ActionIcon>
        )}
        <ActionIcon
          label={selected ? "取消选择消息" : "选择消息"}
          aria-pressed={selected}
          onClick={() => actions.toggle(message.id)}
        >
          {selected ? (
            <CheckSquare size={15} aria-hidden />
          ) : (
            <Square size={15} aria-hidden />
          )}
        </ActionIcon>
        <ActionIcon
          label="复制消息"
          onClick={() => void actions.copy([message])}
        >
          <Copy size={15} aria-hidden />
        </ActionIcon>
      </div>
    </div>
  );
}

export function MessageSelection({ actions }: { actions: MessageActions }) {
  const pinned = actions.messages.filter((message) => message.pinned);
  const jumpTarget = useRef<string | undefined>(undefined);
  return (
    <>
      {!!pinned.length && (
        <Menu.Root modal={false}>
          <Menu.Trigger asChild>
            <button
              type="button"
              className="amadeus-action-icon"
              aria-label={`置顶消息 · ${pinned.length} 条`}
            >
              <Pin size={15} aria-hidden /> <span>{pinned.length}</span>
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              className="amadeus-pin-menu"
              side="top"
              align="start"
              sideOffset={6}
              collisionPadding={12}
              onCloseAutoFocus={(event) => {
                if (!jumpTarget.current) return;
                event.preventDefault();
                actions.jump(jumpTarget.current);
                jumpTarget.current = undefined;
              }}
            >
              <Menu.Label>置顶消息</Menu.Label>
              {pinned.map((message) => (
                <Menu.Item
                  key={message.id}
                  onSelect={() => {
                    jumpTarget.current = message.id;
                  }}
                >
                  {message.content.trim().slice(0, 100)}
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      )}
      {!!actions.selected.length && (
        <div
          className="amadeus-selection-bar"
          aria-label="消息多选"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              actions.select([]);
            }
          }}
        >
          <span>已选 {actions.selected.length} 条消息</span>
          <button
            type="button"
            onClick={() => void actions.copy(actions.selected)}
          >
            复制
          </button>
          <button
            type="button"
            onClick={() => actions.select(actions.messages.map(({ id }) => id))}
          >
            全选
          </button>
          <button type="button" onClick={() => actions.select([])}>
            取消
          </button>
        </div>
      )}
      {actions.feedback && !actions.fork && (
        <span
          className="amadeus-message-feedback"
          role={actions.feedback.error ? "alert" : "status"}
        >
          {actions.feedback.text}
        </span>
      )}
      {actions.fork && (
        <ConfirmDialog
          open
          title="从此消息创建分叉"
          confirmLabel="创建分叉"
          tone="primary"
          description={
            <>
              <span>
                新会话会带上截至这条消息的正文和可访问的工坊引用。原会话中的工作文件、运行记录、审批和已加载能力可回到原会话查看。
              </span>
              {actions.feedback?.error && (
                <span role="alert">{actions.feedback.text}</span>
              )}
            </>
          }
          pending={actions.pendingFork}
          confirmDisabled={actions.busy}
          onCancel={actions.cancelFork}
          onConfirm={actions.confirmFork}
        />
      )}
    </>
  );
}
