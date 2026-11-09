import { ArrowDown } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { bottomFollowIntent } from "./bottomFollowIntent";

export function TranscriptViewport({ children }: { children: ReactNode }) {
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const position = useRef({ offset: 0, height: 0, following: true });
  const [following, setFollowing] = useState(true);
  const moveToBottom = () => {
    const element = scroll.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    position.current = {
      offset: element.scrollTop,
      height: element.scrollHeight,
      following: true,
    };
    setFollowing(true);
  };
  useLayoutEffect(() => {
    const body = content.current;
    const viewport = scroll.current;
    if (!body || !viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (position.current.following) moveToBottom();
    });
    observer.observe(body);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (position.current.following) moveToBottom();
  });
  return (
    <div className="amadeus-transcript-viewport">
      <div
        ref={scroll}
        className="amadeus-messages"
        tabIndex={0}
        aria-label="会话消息"
        onScroll={(event) => {
          const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
          const previous = position.current;
          const next = bottomFollowIntent(
            previous.following,
            previous.offset,
            scrollTop,
            scrollHeight - clientHeight - scrollTop,
            scrollHeight === previous.height,
          );
          position.current = {
            offset: scrollTop,
            height: scrollHeight,
            following: next,
          };
          setFollowing(next);
        }}
      >
        <div ref={content}>{children}</div>
      </div>
      {!following && (
        <button
          type="button"
          className="amadeus-jump-to-bottom"
          onClick={moveToBottom}
        >
          <ArrowDown size={14} aria-hidden /> 回到底部
        </button>
      )}
    </div>
  );
}
