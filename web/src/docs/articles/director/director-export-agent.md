<!-- docs: {"group":"director","order":2,"title":"预演交付与外部 Agent 操作","lead":"保留可编辑工程，并在已打开的场景中使用正式自动化工具。","evidence":["web/src/features/director-desk/editor","backend/app/apps/director_desk","docs/operations/desktop-agent.md","tests/test_director_desk_agent.py"]} -->

# 预演交付与外部 Agent 操作

完成走位与运镜后先保存，再选择预演输出。预演用于检查构图、节奏和空间关系，不替代最终美术制作。

## 导出前核对

确认当前戏段、摄影机、时长、输出尺寸和帧率；检查对象可见性和工程媒体是否完整。播放起点、终点和运动关键位置，确保最终镜头没有意外遮挡。

按编辑器提供的导出选项执行并等待完成；检查最终文件的画面和持续时间。需要继续编辑时同时导出 `.director` 工程包，仅保存视频不能恢复原始场景。

## 外部 Agent 连接

导演台没有编辑器内专属聊天助手。外部 Agent 使用[本地 Agent 接入](/docs.html?page=desktop-agent)的 `fpl` 或 Python SDK，读取工程、文件和动作库。

场景查询、几何检查、改场景和导出操作要求对应工程的编辑器已打开且完成加载。可以先使用 `fpl open director PROJECT_ID` 定位工程；具体方法见[导演台 API 参考](/docs.html?page=sdk-reference-director)。

## 执行与失败恢复

同一项目由最近一次打开的编辑器接收场景工具操作。关闭页面后进行中的调用可能失败；没有打开的编辑器不会排队等待或在后台假装修改场景。

只读授权不能修改场景、导出或取消任务。写操作需要当前权限和最新版本，冲突或连接中断后先查询工程现状，再决定是否重新执行；不要自动重复写入。
