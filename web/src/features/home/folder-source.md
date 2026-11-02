# 首页文件夹来源

`HomeApplicationFolders.tsx` 的文件夹背板曲线和纸片／前盖分层，改编自 React Bits 的 `Folder` matte 变体：

- https://github.com/DavidHDev/react-bits
- 本地参考：`react-bits/src/ts-default/Components/Folder/Folder.tsx`
- 许可证全文随附于 [`react-bits-folder-LICENSE.txt`](../../../public/brand/react-bits-folder-LICENSE.txt)（MIT + Commons Clause）。

仅采用 matte 几何与纸片视觉结构；首页使用 React 状态、原生按钮和 CSS 过渡，省去玻璃 WebGL、拖放、倾斜和自动动画。增加点击及键盘展开、Esc 焦点恢复、真实应用目录注入。未引入新的依赖。

桌面精确指针悬停时，前盖展开并让纸片上浮散开；这是临时视觉预览，不改变点击选择状态。点击、Enter 或 Space 仍固定展开应用名称，Esc 收起并恢复焦点；减少动态效果时取消过渡。
