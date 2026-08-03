import { BrandMark } from "@shared/ui/BrandMark";
import { ThemeToggle } from "@shared/ui/ThemeToggle";

export function DocsApp() {
  return (
    <div className="docs-shell">
      <header className="docs-header">
        <a className="docs-brand" href="/model-service">
          <BrandMark size={40} />
          <div>
            <strong>未来道具研究所</strong>
            <span>文档中心</span>
          </div>
        </a>
        <div className="docs-actions">
          <a href="/model-service">返回 Studio</a>
          <ThemeToggle compact />
        </div>
      </header>
      <main className="docs-empty">
        <div className="docs-orbit" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <span className="eyebrow">DOCUMENTATION</span>
        <h1>文档内容正在准备中</h1>
        <p>这里将承载 Future Props Lab 的使用指南与模型基础设施说明。</p>
        <a className="btn primary" href="/model-service">
          返回模型服务
        </a>
      </main>
      <footer className="docs-footer">Future Props Lab · 未来道具研究所</footer>
    </div>
  );
}
