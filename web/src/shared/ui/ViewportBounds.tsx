import { useEffect } from "react";
import "./viewport-bounds.css";

export function ViewportBounds() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const style = document.documentElement.style;
      style.setProperty(
        "--visible-height",
        `${viewport?.height ?? innerHeight}px`,
      );
      style.setProperty("--visible-top", `${viewport?.offsetTop ?? 0}px`);
    };
    update();
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, []);
  return null;
}
