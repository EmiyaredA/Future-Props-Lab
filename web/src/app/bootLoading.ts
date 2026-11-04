/** Starts the HTML loading scene without importing React or feature modules. */
export function startBootLoading() {
  const scene = document.querySelector<HTMLElement>(
    ".fpl-boot-loading .fpl-loading-scene",
  );
  const video = scene?.querySelector("video");
  if (!scene || !video) return () => {};
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let ready = false;
  let disposed = false;
  let failed = false;
  video.defaultMuted = true;
  video.muted = true;
  const sync = () => {
    if (ready && !document.hidden) {
      scene
        .querySelectorAll<HTMLSourceElement>("source[data-srcset]")
        .forEach((source) => {
          source.srcset = source.dataset.srcset!;
        });
      scene
        .querySelectorAll<HTMLImageElement>("img[data-src]")
        .forEach((image) => {
          if (!image.hasAttribute("src")) image.src = image.dataset.src!;
        });
      if (!video.hasAttribute("poster")) video.poster = video.dataset.poster!;
    }
    const paused = !ready || preference.matches || document.hidden || failed;
    scene.dataset.paused = String(paused);
    if (paused) {
      if (!video.paused) video.pause();
      if (preference.matches) video.parentElement!.dataset.playing = "false";
    } else {
      if (!video.hasAttribute("src")) video.src = video.dataset.src!;
      void video.play().catch((error: unknown) => {
        if (
          !disposed &&
          !document.hidden &&
          !(error instanceof DOMException && error.name === "AbortError")
        )
          fail();
      });
    }
  };
  const fail = () => {
    failed = true;
    video.parentElement!.dataset.playing = "false";
    sync();
  };
  const playing = () => {
    video.parentElement!.dataset.playing = "true";
  };
  const waiting = () => {
    video.parentElement!.dataset.playing = "false";
  };
  video.addEventListener("playing", playing);
  video.addEventListener("waiting", waiting);
  video.addEventListener("error", fail);
  document.addEventListener("visibilitychange", sync);
  preference.addEventListener("change", sync);
  const timer = window.setTimeout(() => {
    ready = true;
    sync();
  }, 150);
  return () => {
    disposed = true;
    window.clearTimeout(timer);
    video.removeEventListener("playing", playing);
    video.removeEventListener("waiting", waiting);
    video.removeEventListener("error", fail);
    document.removeEventListener("visibilitychange", sync);
    preference.removeEventListener("change", sync);
    if (!video.paused) video.pause();
    video.removeAttribute("src");
  };
}
