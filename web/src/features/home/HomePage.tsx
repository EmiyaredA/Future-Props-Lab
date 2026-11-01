import {
  AppWindow,
  ArrowRight,
  Box,
  Compass,
  FlaskConical,
  History,
  Server,
  Sparkles,
} from "lucide-react";
import { Button } from "@shared/ui/button";
import { HomeHeroPet } from "@features/home/HomeHeroPet";
import "@features/home/home.css";

const destinations = [
  {
    title: "应用",
    description: "进入完整的 AI 创作应用，完成更复杂的工作流。",
    action: "浏览应用",
    path: "/apps",
    icon: AppWindow,
  },
  {
    title: "工具导航",
    description: "快速找到单页即用的研发、数据和效率工具。",
    action: "查找工具",
    path: "/tools",
    icon: Compass,
  },
  {
    title: "AI 能力",
    description: "管理模型服务与编程智能体，测试效果并查看调用记录。",
    action: "管理 AI 能力",
    path: "/model-service",
    icon: Box,
  },
];

const modelLinks = [
  {
    title: "模型测试",
    description: "对话调试与参数验证",
    path: "/model-test",
    icon: FlaskConical,
  },
  {
    title: "模型服务",
    description: "供应商与模型目录",
    path: "/model-service",
    icon: Server,
  },
  {
    title: "调用日志",
    description: "用量、耗时与错误记录",
    path: "/model-call-logs",
    icon: History,
  },
];

export function HomePage({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}) {
  return (
    <section className="page home-page">
      <header className="home-header">
        <div className="home-header-copy">
          <div className="home-kicker-row">
            <span className="home-kicker">
              <Sparkles aria-hidden />
              工作台
            </span>
          </div>
          <h1>今天想从哪里开始？</h1>
          <p>把灵感、模型和工具，收拢到一个顺手的创作环境。</p>
        </div>
        <HomeHeroPet />
      </header>

      <div className="home-destinations" aria-label="功能导航">
        {destinations.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.path}
              variant="default"
              size="lg"
              className="home-destination-card"
              onClick={() => onNavigate(item.path)}
            >
              <span className="home-destination-icon">
                <Icon aria-hidden />
              </span>
              <span className="home-destination-copy">
                <strong>{item.title}</strong>
                <small>{item.description}</small>
                <span>
                  {item.action}
                  <ArrowRight aria-hidden />
                </span>
              </span>
            </Button>
          );
        })}
      </div>

      <section className="home-quick-section">
        <header>
          <div>
            <h2>模型快捷入口</h2>
            <p>常用的模型基础设施功能</p>
          </div>
        </header>
        <div className="home-quick-grid">
          {modelLinks.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => onNavigate(item.path)}
              >
                <span className="home-quick-icon">
                  <Icon aria-hidden />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
                <ArrowRight aria-hidden />
              </button>
            );
          })}
        </div>
      </section>
    </section>
  );
}
