import * as Menu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Link2, MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import type { ResolvedCanvasInput } from "./generationDrawerTypes";

export function ReferenceAssetDetails({
  title,
  input,
  subject,
  onManage,
  onRemove,
  order,
  children,
}: {
  title: string;
  input?: ResolvedCanvasInput;
  subject?: string;
  onManage?: () => void;
  onRemove: () => void;
  order?: { index: number; total: number; move: (to: number) => void };
  children?: ReactNode;
}) {
  const description = (
    <>
      <strong>{title}</strong>
      {subject && <small>追踪对象：{subject}</small>}
      <small>
        {input
          ? `来源：任务输出 · ${input.edge.binding === "fixed" ? "固定" : "跟随最终输出"} ${input.version ? `v${input.version}` : ""}`
          : "来源：项目素材"}
      </small>
      {input?.error && <small>{input.error}</small>}
    </>
  );
  return (
    <Menu.Root>
      <Tooltip.Provider delayDuration={350}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Menu.Trigger asChild>
              <button
                type="button"
                className="reference-details-trigger"
                aria-label={`参考详情 ${title}`}
              >
                {input ? <Link2 size={13} /> : <MoreHorizontal size={13} />}
              </button>
            </Menu.Trigger>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="reference-tooltip" sideOffset={6}>
              {description}
              <Tooltip.Arrow />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
      <Menu.Portal>
        <Menu.Content
          className="reference-menu reference-details-menu"
          sideOffset={5}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div className="reference-description">
            {description}
            {children}
          </div>
          {onManage && (
            <Menu.Item onSelect={onManage}>管理版本与用途</Menu.Item>
          )}
          {order && (
            <>
              <Menu.Item
                disabled={order.index === 0}
                onSelect={() => order.move(order.index - 1)}
              >
                前移
              </Menu.Item>
              <Menu.Item
                disabled={order.index === order.total - 1}
                onSelect={() => order.move(order.index + 1)}
              >
                后移
              </Menu.Item>
            </>
          )}
          <Menu.Item onSelect={onRemove}>移除引用</Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
