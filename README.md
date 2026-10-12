# YouTube 视频学习笔记（Brave / Chrome 扩展）

> 看 YouTube 时，在浏览器侧边栏里直接记笔记：富文本、时间戳、一键截取视频画面，并可一键搬到 IMA 笔记 / 飞书 / Notion / Obsidian。所有数据存在本地，
>
> **不需要账号、服务器或 API Key**
>
> 。



* 版本：**v1.1.0**（Manifest V3）

* 支持浏览器：**Brave 桌面版、Google Chrome**（同为 Chromium 内核，Edge 亦可使用）

* 仓库：[https://github.com/qzx151/brave-YouTube-note](https://github.com/qzx151/brave-YouTube-note)

* 下载：[https://github.com/qzx151/brave-YouTube-note/releases](https://github.com/qzx151/brave-YouTube-note/releases)



***

## 功能特性

### 写笔记



* 每个 YouTube 视频一份独立笔记，按视频 ID 绑定；切换视频自动加载，**互不串用**

* 富文本：标题、加粗、斜体、删除线、有序 / 无序列表、引用、链接、撤销 / 重做

* 自动保存（停止输入约 0.7 秒后落盘），顶部显示「保存中 / 已保存 / 保存失败」

* 支持中文输入法；刷新页面、关闭重开、**重启浏览器**后内容完整恢复

### 时间戳



* 点一下按钮插入当前播放时间（如 `01:13`）

* 点击时间戳立即跳回视频对应位置，并保持原播放 / 暂停状态

* 复制或导出时，时间戳自动变成可点击的 YouTube 链接（`?v=…&t=…s`）

### 一键截图（核心功能）



* 工具栏点相机图标，自动抓取当前视频画面

* 按视频元素真实位置和尺寸裁剪，**只保留视频画面**，不含导航栏、推荐栏、评论区

* 截图插入**当前光标位置**，可在图片前后继续写字；图注带时间戳，点击可跳回

* 图片以 PNG Blob 存入 IndexedDB（独立资源表、通过 ID 关联，不塞 Base64 文本）；删除图片后自动回收

### 一键搬运到其他笔记工具



* **复制全文（含图片）**：图文一起复制，直接粘贴到 IMA 笔记 / 飞书 / Notion / Word

* **导出 Markdown ZIP**：下载 `视频标题.zip`（`note.md` + `images/*.png`），解压放进 Obsidian Vault 即可



***

## 安装（普通用户，推荐）



1. 打开 Releases 页：[https://github.com/qzx151/brave-YouTube-note/releases](https://github.com/qzx151/brave-YouTube-note/releases)

2. 在最新版本的 **Assets** 中下载 `youtube-learning-notes-1.1.0-chrome.zip`

3. 右键下载的 zip → **「全部解压」**

4. 打开浏览器扩展页：

* Brave：地址栏输入 `brave://extensions`

* Chrome：地址栏输入 `chrome://extensions`

1. 打开右上角 **「开发者模式」** → 点 **「加载已解压的扩展程序」** → 选择解压出的文件夹

2. 建议点工具栏拼图图标把扩展固定；打开 YouTube 视频，点扩展图标即开始记笔记

> 注意：不要直接加载 GitHub 页面绿色 
>
> **Code → Download ZIP**
>
>  得到的压缩包，那是给开发者的源码，不是构建好的扩展。



***

## 使用速览



1. 打开普通视频页 `https://www.youtube.com/watch?v=...`

2. 点击扩展图标，右侧打开笔记侧边栏（浏览器不支持侧边栏时，自动在新标签页打开功能相同的笔记页）

3. 直接输入文字；工具栏可加粗、建标题、列表、插链接

4. 播放到关键点 → 点时钟图标插入时间戳；点击时间戳可跳回

5. 点相机图标，视频画面自动插入当前光标

6. 点剪贴板图标复制全文（去 IMA / 飞书 / Notion）；点文件图标导出 ZIP（去 Obsidian）



***

## 权限说明

扩展遵循最小权限原则：



| 权限                      | 用途                                     |
| ----------------------- | -------------------------------------- |
| `sidePanel`             | 在浏览器侧边栏打开笔记界面                          |
| `activeTab`             | 点击扩展图标后临时访问当前标签页，用于读取视频状态与截图           |
| `storage`               | 保存少量编辑器偏好                              |
| host 权限：仅 `youtube.com` | 注入脚本、读取播放器状态与视频元素位置                    |
| 可选 `<all_urls>`（不主动申请）  | 当 activeTab 授权失效时作为截图兜底，点击相机时才弹窗请求，可拒绝 |

实测：新版 Chromium 中 `captureVisibleTab` 不再接受窄域 host 授权，必须由 `activeTab`（点击扩展图标的手势）或 `<all_urls>` 授权。因此**请通过点击扩展图标打开侧边栏**后再截图。



***

## 项目结构



```
├─ entrypoints/
│  ├─ background.ts        # Service Worker：侧边栏行为、captureVisibleTab
│  ├─ youtube.content.ts   # Content Script：读取视频状态/位置、执行跳转
│  ├─ sidepanel/           # 侧边栏入口
│  └─ notes/               # 降级独立页面入口
├─ components/             # App、Toolbar、NoteEditor、Toaster
├─ editor/                 # Tiptap 自定义节点：时间戳、截图
├─ hooks/
├─ lib/
│  ├─ db.ts                # Dexie / IndexedDB：笔记表 + 截图资源表 + GC
│  ├─ video.ts             # 视频 ID 解析、时间格式化
│  ├─ geometry.ts          # 裁剪几何：DPR、缩放比、边界夹取
│  ├─ screenshot.ts        # 截图全链路
│  ├─ exporter.ts          # 复制富文本 / Markdown 序列化 / ZIP 编排
│  ├─ zip.ts               # 零依赖 ZIP 打包
│  └─ playerBridge.ts      # 面板与 content script 通信
├─ public/icons/           # 扩展图标
├─ scripts/                # CDP 端到端测试脚本
├─ tests/                  # 单元测试
└─ wxt.config.ts
```



***

## 开发与构建

环境要求：Node.js 18+（本机实测 Node v22 /npm 10）。



```
npm install        # 安装依赖
npm run typecheck  # TypeScript 类型检查
npm test           # 单元测试（纯逻辑，无需浏览器）
npm run build      # 构建产物到 .output/chrome-mv3/
npm run zip        # 打包可分发 zip
npm run dev        # 开发模式（热重载）
```

技术栈：WXT・React 19・TypeScript・Tiptap v2・Dexie.js・Tailwind CSS v4・lucide-react



***

## 测试结果

在真实 Brave（155，Chromium 155 内核）运行时上通过 CDP 自动化验证（非 mock）：



* **单元测试：19/19 通过**（视频 ID、时间格式、裁剪几何、序列化、ZIP 结构）

* **主功能端到端：13/13 通过**（笔记、时间戳跳转、截图裁剪与持久化、视频切换隔离、重启恢复）

* **复制 / 导出端到端：8/8 通过**（剪贴板含内嵌图片约 822KB；导出 ZIP 含 note.md 与真实 PNG 约 554KB）

* **下载链路已验证**：Release 资产字节级与本地构建一致（SHA-256 校验）

未在真实 GUI 人工验证（已尽量由自动化覆盖）：点击图标打开侧边栏的手势、`<all_urls>` 弹窗点击、IMA 网页粘贴图片、真实 GUI 下载落盘、Shields / 缩放 / 影院模式观感。



***

## 已知限制



* 仅支持普通视频页 `youtube.com/watch?v=...`，暂不支持 **Shorts**（面板会提示打开普通视频）

* 全屏时侧边栏不可见，截图需先退出全屏

* 截图会包含播放器控制条 / 进度条（鼠标悬停时），属预期行为

* 删除截图后资源在下一次自动保存时由 GC 回收

* 卸载扩展或清除浏览器扩展数据会删除本地笔记，请定期导出 ZIP 备份



***

## 后续计划



* 导入 Markdown ZIP 还原笔记；导出 HTML 单文件（图片内嵌）

* 笔记列表页（封面、频道、更新时间、搜索、批量导出）

* 截图标注（箭头 / 文字 / 马赛克）、选区裁剪、连续截图、快捷键

* 时间戳大纲、按时间戳片段复习模式

* Shorts、播放列表、嵌入视频、移动端适配

* 字幕抓取与时间戳对齐（纯本地实现）



***

## 许可证

本项目基于 **MIT License** 开源：任何人可自由使用、修改和分发（含商用），只需保留版权声明。详情见 [LICENSE](./LICENSE)。

***

## 隐私

扩展完全在本地运行：不收集任何数据、不连接第三方服务器、不需要 API Key、不下载视频。所有笔记和截图仅保存在你浏览器的 IndexedDB 中。