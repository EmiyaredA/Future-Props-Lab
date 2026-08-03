import { AssetBrowser } from "@features/files/AssetBrowser";

export function FileManagementPage() {
  return (
    <section className="file-management-page">
      <header>
        <div>
          <span>工作空间</span>
          <h1>文件管理</h1>
          <p>统一管理可供各个项目引用的图片、视频、音频和文档。</p>
        </div>
      </header>
      <AssetBrowser />
    </section>
  );
}
