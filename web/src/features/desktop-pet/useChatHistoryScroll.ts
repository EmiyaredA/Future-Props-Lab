import { useLayoutEffect, useRef, useState } from "react";
import type { PetChatMessage } from "./api";

/** Presentation state only: prepends preserve the reader's anchor; replies follow near the bottom. */
export function useChatHistoryScroll(
  messages: PetChatMessage[],
  outgoing: string,
  streaming: string,
  visible: boolean,
) {
  const history = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const savedTop = useRef(0);
  const prepend = useRef<{ top: number; height: number } | null>(null);
  const [awayFromLatest, setAwayFromLatest] = useState(false);

  const trackScroll = () => {
    const element = history.current;
    if (!element) return;
    savedTop.current = element.scrollTop;
    following.current =
      element.scrollHeight - element.clientHeight - element.scrollTop <= 48;
    setAwayFromLatest(!following.current);
  };
  const scrollToLatest = () => {
    following.current = true;
    prepend.current = null;
    setAwayFromLatest(false);
    const element = history.current;
    if (element) {
      element.scrollTo({ top: element.scrollHeight });
      savedTop.current = Math.max(
        0,
        element.scrollHeight - element.clientHeight,
      );
    }
  };
  const preservePrepend = () => {
    const element = history.current;
    if (element)
      prepend.current = {
        top: element.scrollTop,
        height: element.scrollHeight,
      };
  };
  useLayoutEffect(() => {
    const element = history.current;
    if (!element || !visible) return;
    const anchor = prepend.current;
    prepend.current = null;
    if (anchor) {
      element.scrollTop = anchor.top + element.scrollHeight - anchor.height;
      savedTop.current = element.scrollTop;
      following.current =
        element.scrollHeight - element.clientHeight - element.scrollTop <= 48;
    } else if (following.current) {
      element.scrollTo({ top: element.scrollHeight });
      savedTop.current = Math.max(
        0,
        element.scrollHeight - element.clientHeight,
      );
    } else {
      element.scrollTop = savedTop.current;
    }
    setAwayFromLatest(!following.current);
  }, [messages, outgoing, streaming, visible]);

  return {
    history,
    awayFromLatest,
    trackScroll,
    scrollToLatest,
    preservePrepend,
  };
}
