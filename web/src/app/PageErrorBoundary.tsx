import { Component, type ReactNode } from "react";
import { recoverPage } from "./recovery";
import "./recovery.css";

export class PageErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; action: "reload" | "home" | null }
> {
  state: { error: Error | null; action: "reload" | "home" | null } = {
    error: null,
    action: null,
  };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="fpl-recovery" role="alert">
        <h1>页面暂时无法显示</h1>
        <p>
          页面运行出现错误。已保存的数据不受影响，未保存的修改可能需要恢复。
        </p>
        <details>
          <summary>错误摘要</summary>
          <pre>{String(this.state.error.message).slice(0, 500)}</pre>
        </details>
        {this.state.action ? (
          <>
            <p>此操作将离开当前页面。请确认可以放弃尚未保存的修改。</p>
            <button onClick={() => this.setState({ action: null })}>
              留在此页
            </button>
            <button onClick={() => recoverPage(this.state.action === "home")}>
              确认继续
            </button>
          </>
        ) : (
          <>
            <button onClick={() => this.setState({ action: "reload" })}>
              重新加载
            </button>
            <button onClick={() => this.setState({ action: "home" })}>
              返回首页
            </button>
          </>
        )}
      </section>
    );
  }
}
