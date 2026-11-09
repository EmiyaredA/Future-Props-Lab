import { lazy } from "react";
import { ToolNavigationPage } from "@features/tools/ToolNavigationPage";
import { StudioServiceShell } from "./StudioServiceShell";
import { guardedNavigation } from "./navigation";

const VideoFrameExporterPage = lazy(() =>
  import("@features/tools/VideoFrameExporterPage").then((module) => ({
    default: module.VideoFrameExporterPage,
  })),
);
const VideoDownloaderPage = lazy(() =>
  import("@features/tools/VideoDownloaderPage").then((module) => ({
    default: module.VideoDownloaderPage,
  })),
);

function open(path: string) {
  guardedNavigation(() => window.location.assign(path), true);
}

function ToolsContent() {
  const pathname = window.location.pathname.replace(/\/+$/, "");
  const back = () => open("/tools");
  switch (pathname) {
    case "/tools":
      return <ToolNavigationPage onOpenInternal={open} />;
    case "/tools/video-frame-exporter":
      return <VideoFrameExporterPage onBack={back} />;
    case "/tools/video-downloader":
      return <VideoDownloaderPage onBack={back} />;
    default:
      return (
        <section className="independent-not-found">
          <h1>页面不存在</h1>
          <a href="/tools">返回工具导航</a>
        </section>
      );
  }
}

export default function ToolsApplication() {
  return (
    <StudioServiceShell title="工具导航">
      <ToolsContent />
    </StudioServiceShell>
  );
}
