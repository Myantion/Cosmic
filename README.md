# Cosmic · 宇宙桌宠

> Electron 透明桌宠 · WebGL2 黑洞渲染 · 引力透镜 · 可定制吸积盘

一款运行在 Windows 上的透明桌面宠物。基于 WebGL2 着色器实时渲染 Schwarzschild 黑洞、吸积盘与引力透镜效果，窗口可拖拽置顶，系统托盘提供快捷控制与设置面板。

## 特性

- **物理光学风格渲染** — WebGL2 光线步进模拟黑洞本影、吸积盘多普勒增亮与 bloom 光晕
- **实时引力透镜** — 捕获桌面画面，在外围形成背景扭曲效果
- **三种观测形态** — Interstellar 斜视 / EHT 环视 / 侧视狭缝，双击桌宠或托盘菜单切换
- **透明无边框窗口** — 始终置顶，可拖拽移动，鼠标移出核心区域自动穿透
- **系统托盘** — 显示/居中、置顶、切换形态、刷新背景、打开设置、退出
- **可视化设置** — 调节黑洞大小与吸积盘颜色，每项可单独恢复默认，设置自动持久化
- **Windows 打包** — 支持生成 NSIS 安装包与绿色版

## 环境要求

- Windows 10 / 11（x64）
- 支持 **WebGL2** 的显卡与驱动
- 开发运行需 [Node.js](https://nodejs.org/) 18+

## 快速开始

### 从源码运行

```bash
git clone https://github.com/Myantion/Cosmic.git
cd Cosmic
npm install
npm start
```

首次启动若弹出**屏幕共享 / 录屏权限**，请允许——引力透镜需要读取桌面画面才能生效。

### 下载安装包

前往 [Releases](https://github.com/Myantion/Cosmic/releases) 下载最新版 Windows 安装包，双击安装即可。

### 自行打包

```powershell
# 国内网络建议设置镜像
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
$env:CSC_IDENTITY_AUTO_DISCOVERY="false"

npm run build
```

打包产物位于 `dist/`：

| 文件 | 说明 |
|------|------|
| `宇宙桌宠 Setup 1.0.0.exe` | NSIS 安装包 |
| `win-unpacked/宇宙桌宠.exe` | 绿色版（需保留整个文件夹） |

## 使用说明

### 桌宠窗口

| 操作 | 效果 |
|------|------|
| 拖拽 | 移动桌宠位置 |
| 双击 | 切换黑洞形态 |
| 鼠标移出核心 | 点击穿透到下层窗口 |

### 系统托盘

右键托盘图标：

- **显示到屏幕中央** — 将桌宠移到屏幕正中
- **置顶 / 取消置顶** — 切换窗口置顶
- **切换黑洞形态** — 在三种观测视角间循环
- **刷新桌面背景** — 手动更新透镜用的桌面快照（会短暂闪烁）
- **设置** — 打开设置面板
- **退出** — 关闭应用

### 设置面板

托盘 → **设置**，可调整：

| 选项 | 说明 | 默认值 |
|------|------|--------|
| 黑洞大小 | 施瓦西半径，影响本影与吸积盘整体尺度 | `0.11` |
| 吸积盘颜色 | 盘面主色调，自动生成亮部/暗部配色 | `#ffae24` |

每项右侧有 **恢复默认** 按钮。设置保存在用户目录下的 `settings.json`，重启后自动加载。

## 项目结构

```
Cosmic/
├── main.js              # Electron 主进程：窗口、托盘、IPC、设置持久化
├── preload.js           # 桌宠窗口预加载脚本
├── renderer.js          # WebGL2 渲染与交互
├── index.html           # 桌宠页面
├── settings.html        # 设置界面
├── settings-preload.js
├── settings-renderer.js
├── settings-defaults.js # 默认值与颜色换算
└── package.json
```

## 技术栈

- [Electron](https://www.electronjs.org/) — 透明窗口、系统托盘、桌面捕获
- **WebGL2 / GLSL** — 黑洞光线步进、吸积盘噪声、引力透镜后处理
- [electron-builder](https://www.electron.build/) — Windows 打包

## 常见问题

**Q: 看不到引力透镜效果？**  
A: 确认已允许屏幕捕获权限；可在托盘中点击「刷新桌面背景」重试。

**Q: 调大黑洞后画面被裁切？**  
A: 窗口会随黑洞大小自动缩放；若仍异常，可在设置中恢复默认大小后重试。

**Q: 打包失败 / 下载 Electron 超时？**  
A: 使用上文中的国内镜像环境变量后重新 `npm run build`。
