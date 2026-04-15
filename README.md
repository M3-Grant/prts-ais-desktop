# PRTS.AIS
基于社区可获取的 **Claude Code 相关衍生实现** 进行修复与增强的本地版本。本说明与仓库内容整理参考了 B 站 UP 主公开视频（见下文「版权声明与来源」），在保留 TUI 与 Agent 能力思路的基础上，额外集成了 **Electron 桌面端**，并支持通过环境变量接入各类 **Anthropic 协议兼容** 的 API 端点。使用第三方模型或服务时，请自行遵守相应服务条款与所在地法律法规。

---

## 核心特性

- **双端体验**：
  - **终端 TUI**：基于 React + Ink 的完整命令行交互界面，支持工具调用、代码编辑和多步迭代。
  - **桌面端 (Electron)**：提供 Vue 3 构建的图形化聊天界面，支持会话管理、工作区切换、可视化设置与请求诊断。
- **全能 Agent**：内置 `BashTool`（执行终端命令）、`FileEditTool`（精准代码编辑）、`Grep/GlobTool`（代码搜索）及内置技能（如 `simplify` 代码审阅流程）等；本地模型在助手模式下可能模仿工具 JSON 输出，桌面端会对常见形态做解包与展示优化。
- **高度可定制**：通过 `.env` 配置 API 端点、模型参数及超时设置，兼容 MiniMax、OpenRouter 等第三方服务；桌面构建可配合 `VITE_*` 开关调试展示层行为。
- **稳定性修复**：针对原始源码在本地环境下的启动卡死、按键失效、依赖缺失等问题进行了深度修复。

### 桌面端功能详解

桌面端提供直观的图形界面，让您无需命令行即可享受 Claude Code 的强大能力：

- **聊天界面**：
  - 实时对话：与界面中的 **PRTS** 助手对话（产品名仍为普瑞赛斯主题）；支持编码任务输入，助手气泡支持 **Markdown** 渲染。
  - 消息管理：查看历史消息，支持清除消息、新建会话；**有新消息或流式更新时自动滚动到底部**。
  - **重新输出**：最后一条助手气泡标题栏右侧提供循环图标；使用与上一条用户消息相同的请求再次生成。若本轮返回状态为 **「完整」**，会自动删除上一版该条助手回复，仅保留新版；若未完整结束或失败，则保留旧版并移除本次占位气泡。
  - 思考指示器：助手无正文输出时显示处理中动画。

- **Ollama 双模式**（运行模式为本地 Ollama 时）：
  - **普瑞赛斯**：直连 Ollama 生成接口，侧重人格对话，**不注入**工程目录下的代码/文件上下文（编码类问题可提示切换助手模式）。
  - **助手**：走与云端相同的 **Claude Code CLI**（`stream-json`），可在当前工作区内读文件、用工具链；切换模式时会新建会话并清空聊天，避免两种上下文串线。

- **智能配置**：
  - **运行模式切换**：云端 API（OpenRouter/Anthropic）与本地 Ollama。
  - **API 配置**：安全输入和管理 API Key，支持多种提供商。
  - **模型选择**：云端模式固定使用 `openrouter/auto`；Ollama 模式支持自定义模型（如 `qwen3:4b`）。
  - **项目工作区**：选择本地项目目录；助手/云端下可将 **README**、关键源码等纳入上下文，并在路径或提问中显式包含文件路径时优先注入 **目标文件** 全文。

- **诊断与调试**：
  - 侧栏展示最近一次请求的摘要：链路（普瑞赛斯直连 / 助手 CLI / 云端）、prompt 长度、是否注入工作区/目标文件、会话历史是否携带、**CLI 工作目录 / 退出码 / stderr 预览** 等，便于排查本地 CLI 与模型行为。

- **用户体验优化**：
  - **自适应主题**：根据背景自动生成和谐的按钮和界面颜色。
  - **玻璃拟态与侧栏**：横幅/聊天区/设置侧栏强度可调（毛玻璃与叠色）；设置区可滚动，与聊天区布局分离。
  - **头像系统**：用户与助手均可配置头像资源。
  - **路径显示**：展示项目路径，支持展开/收起和打开所在磁盘。
  - **输入区**：聊天底部多行输入框独立样式（圆角容器、占位与选中文本高亮），Enter 发送、Shift+Enter 换行。

- **会话控制**：
  - 新建会话：开始新的对话上下文（与 CLI 会话 id 对齐时可恢复多轮）。
  - 停止任务：中断正在执行的编码任务。
  - 状态指示：助手气泡上显示「生成中 / 完整 / 异常」等与 CLI 流式状态相关的标签。

- **高级功能**：
  - **流式响应**：通过主进程解析 CLI 的 JSON 行事件，向渲染进程增量推送文本（若环境支持）。
  - **工具 JSON 与调试**：默认尽量展示模型原文；若整条回复为工具形 JSON（如 `simplify` 的 `arguments.content`），主进程会在返回前尝试 **解包为可读正文**。如需恢复强剥离与占位提示，可开启下方环境变量。
  - **错误处理**：API、IPC、CLI 非零退出等均有界面提示。
  - **设置持久化**：桌面内保存的配置会写回环境相关存储，下次启动恢复。

---

## 快速开始

### 1. 环境准备
- **Bun** >= 1.1 (推荐)
- **Node.js** >= 18

```bash
npm install
```

### 2. 配置项目
复制并编辑环境变量：
```bash
cp .env.example .env
```
在 `.env` 中填入你的 `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN`。

### 3. 运行程序

#### 运行终端 TUI (推荐)
```bash
# 交互模式
./bin/prts-ais-desktop

# 单次执行 (无头模式)
./bin/prts-ais-desktop -p "帮我分析当前目录结构"
```

#### 运行桌面端 (Electron)
```bash
pnpm desktop:dev
```
（亦可用 `npm run desktop:dev`；依赖安装见上文「运行环境与额外依赖」。）

---

## 项目架构

你在磁盘上把本仓库的**根目录文件夹**命名为任意名称（例如 `prts-ais-desktop`）均可；代码与脚本均使用**仓库内相对路径**，不依赖该文件夹名。`package.json` 中的 **`name` 字段**（当前为 `prts-ais-desktop`）用于 npm 包标识与全局 `bin` 命令名，可与磁盘文件夹名一致或不同。

本项目采用模块化设计，主要分为以下核心部分：

- **`bin/`**: 统一入口脚本（如 `prts-ais-desktop`），由 Node 调起 Bun 并路由至不同运行模式。
- **`src/`**: 核心逻辑层。
  - `entrypoints/`: CLI 入口逻辑。
  - `tools/`: Agent 核心工具集（Bash, Edit, MCP 等）。
  - `skills/bundled/`: 内置技能（含 `simplify` 等），CLI 系统提示会引用；本地模型偶发以 JSON 模仿工具调用属预期现象之一。
  - `services/`: API 通信、LSP 客户端及 MCP 协议实现。
  - `ink/`: 深度定制的终端渲染引擎。
- **`desktop/`**: 桌面端实现。
  - `main.cjs`: Electron 主进程，负责与 CLI 通信、组装 prompt（含工作区/目标文件/人格与助手策略）、解析 `stream-json`、可选工具 JSON 清理与解包。
  - `renderer/`: 基于 Vue 3 + Vite 的前端（聊天、设置、诊断、Markdown 与重新输出等）。

---

## 关键修复说明

我们对所基于的上游与社区衍生代码进行了以下关键性修复，以提升在本地环境下的可运行性与稳定性：

| 模块 | 修复内容 |
| :--- | :--- |
| **启动链路** | 修复了入口脚本错误的路由逻辑，确保无参数启动时能进入完整 TUI 模式。 |
| **交互性能** | 解决了 `modifiers-napi` 缺失导致的 Enter 键失效问题，增强了输入响应的健壮性。 |
| **依赖补全** | 针对缺失的 `.md` 说明文档和 `.txt` 提示词模板添加了桩文件，防止 Bun 加载器卡死。 |
| **桌面集成** | 重新开发了 Electron 与核心 CLI 的通信桥接，支持流式 JSON 输出解析、诊断信息回传与 Ollama 双模式路由。 |

---

## 环境变量指南

### 通用（`.env` 与主进程）

| 变量名 | 说明 |
| :--- | :--- |
| `ANTHROPIC_API_KEY` | 你的 Anthropic API Key。 |
| `ANTHROPIC_BASE_URL` | 自定义 API 转发地址（可选）。 |
| `ANTHROPIC_MODEL` | 默认使用的模型 ID（如 `claude-3-7-sonnet-latest`）。 |
| `MODEL_PROVIDER` | 桌面/CLI 使用的提供方，如 `anthropic` 或 `ollama`。 |
| `OLLAMA_BASE_URL` | 本地 Ollama 服务地址，默认 `http://127.0.0.1:11434`。 |
| `OLLAMA_MODEL` | Ollama 模型名。 |
| `API_TIMEOUT_MS` | 请求超时（毫秒）。 |
| `CLAUDE_CONFIG_DIR` | 配置文件存放路径（默认为 `~/.claude`）。 |
| `DISABLE_TELEMETRY` | 设置为 `1` 以禁用匿名数据遥测。 |
| `TUDOU_TOOL_JSON_MASK` | 设为 `1` 或 `true` 时，主进程对 CLI 助手正文做 **工具 JSON 强剥离** 与占位替换；**不设则保留原文**并仍尝试「整段工具 JSON → 正文」解包，便于对照模型输出。 |

### 桌面渲染层（Vite 构建期）

| 变量名 | 说明 |
| :--- | :--- |
| `VITE_TOOL_JSON_MASK` | 设为 `1` 或 `true` 时，气泡内 Markdown 渲染前会 **剥离工具形 JSON** 并在无可展示正文时显示提示；与 `TUDOU_TOOL_JSON_MASK` 配合可在前后端同时开启强屏蔽。需重新执行 `npm run desktop` 或对应 dev 命令使变量生效。 |

---

## 技术栈

- **运行时**: [Bun](https://bun.sh)
- **UI 框架**: React (TUI) / Vue 3 (Desktop)
- **桌面框架**: Electron
- **通讯协议**: MCP (Model Context Protocol), LSP (Language Server Protocol)

---

## 运行环境与额外依赖

在克隆仓库并执行 `pnpm install` 或 `npm install` 安装 Node 依赖之外，建议按需准备下列软件（版本以能运行本仓库 `package.json` 为准，**Node.js ≥ 18**）：

| 用途 | 说明 |
| :--- | :--- |
| **包管理器** | 推荐使用 **pnpm**（脚本中已写 `pnpm run …`）；使用 npm 时需自行将命令改为 `npm run …`。 |
| **Bun（可选）** | 若使用仓库推荐的 TUI/脚本路径，请安装 [Bun](https://bun.sh)（版本 ≥ 1.1）。仅用 Node 跑桌面端时，以 Node + pnpm/npm 即可。 |
| **Git** | 克隆与更新本仓库。 |
| **Ollama（本地模式）** | 桌面选择 **Ollama** 或 CLI 走本地兼容端点时，需安装 [Ollama](https://ollama.com) 并 **拉取基础模型**（与下方 `Modelfile` 中 `FROM` 一致，例如 `ollama pull qwen2.5-coder:7b`）。服务默认监听 `http://127.0.0.1:11434`。 |
| **云端 API（可选）** | 使用云端模式时，在应用或 `.env` 中配置可用的 **Anthropic 兼容** Key 与地址（如 OpenRouter、MiniMax 等，以你实际接入为准）。 |

### 启动桌面端（开发）

依赖安装完成后，在项目根目录执行：

```bash
pnpm desktop:dev
```

该命令会并行启动 Vite 开发服务与 Electron（详见 `package.json` 中 `desktop:*` 脚本）。**打包发布**可使用 `pnpm run desktop:build`（需已配置好 `electron-builder` 相关环境）。

> **说明**：`desktop:electron:dev` 脚本中 Windows 使用 `set VITE_DEV_SERVER_URL=...`；若在 macOS/Linux 上开发，需改为对应平台的导出方式或自行用工具注入该环境变量。

### 本地生成目录说明（构建产物与依赖安装）

下列路径均为 **机器在本机生成或下载** 得到的内容，**不是**你应在仓库里手写维护的源码；**一般不应提交到 Git**（本仓库 `.gitignore` 已忽略 `node_modules`、`desktop/dist`、`dist` 等常见路径）。

**（1）构建产物** —— 由 **Vite / electron-builder** 等 **build / pack** 命令，根据你的前端源码与打包配置**编译或打包生成**：

| 路径 | 来源 | 说明 |
| :--- | :--- | :--- |
| **`desktop/dist/`** | `pnpm run desktop:ui:build` 或 `pnpm run desktop:build` 中的 Vite 步骤 | 配置见 `desktop/vite.config.ts` 的 `build.outDir`：Vue 前端生产构建输出。 |
| **仓库根目录 `dist/`** | `pnpm run desktop:build` 中的 **electron-builder** 等 | 常见为安装包、`win-unpacked` 等解包目录；体积大、与平台相关。脚本 `postdesktop:build` 会提示安装包位置，具体以 **electron-builder 实际配置** 为准（若将来改过输出目录，以配置为准）。 |

**（2）依赖安装目录** —— 与上表 **性质不同**：**不是**「把本仓库源码编译一遍」的产物，而是包管理器从 registry **安装第三方包** 的结果：

| 路径 | 来源 | 说明 |
| :--- | :--- | :--- |
| **`node_modules/`** | `pnpm install` / `npm install` 等 | 依赖解析与下载后的目录；**在未执行任何前端/Electron 构建时也会存在**。可与构建产物一样不纳入版本库，通过 lockfile（如 `pnpm-lock.yaml`）在他人机器上 **可复现安装**，但概念上属于 **依赖安装产物**，而非 Vite/Electron 的构建输出。 |

开发时使用 `pnpm desktop:dev` 走 Vite 开发服务器（默认 `http://127.0.0.1:5173`），**不会**依赖已生成的 `desktop/dist/` 才能启动；只有执行 **生产构建** 后才会生成/更新 `desktop/dist/`。

---

## 人格（Modelfile）创建说明

**普瑞赛斯** 本地人格由仓库内 **`prompt/Modelfile`** 定义：其中 `FROM` 指向 Ollama 中的**底模名称**，`SYSTEM """..."""` 为人格与语气规则。可按下列步骤创建自定义 Ollama 模型并在桌面里选用：

1. **安装 Ollama** 并拉取与 `FROM` 一致的底模，例如：  
   `ollama pull qwen2.5-coder:7b`
2. **编辑** `prompt/Modelfile`：按需修改 `FROM`、SYSTEM 正文及 `PARAMETER`（温度、最大生成长度等）。
3. **从 Modelfile 创建模型**（示例名 `priestess`，可改成你喜欢的名字）：  
   ```bash
   ollama create priestess -f prompt/Modelfile
   ```
4. 在桌面 **快速配置** 中把 **Ollama 模型** 填为上述名称（如 `priestess`），运行模式选 **Ollama**，人格模式选 **普瑞赛斯**，即可使用该人格对话。

> 未放置或未使用自定义 `Modelfile` 时，普瑞赛斯模式仍受应用内锁定人设文案影响；若希望与底模强绑定，请以 Ollama 侧 `ollama create` 结果为准。

---

## 版权声明与来源

本 README 与仓库实践说明的整理，参考了哔哩哔哩公开视频：[BV1SU9jBAE48](https://www.bilibili.com/video/BV1SU9jBAE48)（请以 UP 主实际页面与标题为准）。

关于本项目中“普瑞赛斯（Priestess）”相关的人物设定、艺术风格、世界观表达与命名参考，特此声明：其艺术来源与相关参考均来自 **上海（中国）鹰角网络有限公司** 旗下游戏作品 **《明日方舟》** 及其官方衍生内容（包括但不限于官方公开素材、宣传文本与世界观设定）。

上述相关角色形象、名称、设定、美术风格及其他可能受知识产权保护的内容，其权利归属于各合法权利人（包括但不限于鹰角网络及相关主体）。本项目仅作学习交流与技术研究用途，不构成任何形式的官方授权、合作关系或商业背书；使用者在复制、修改、传播或二次创作时，应自行确认合法性与合规性，并承担由此产生的一切责任。

**社区开源的、功能对标 Claude Code 的本地可运行实现** 的公开参考仓库包括但不限于：

- **本仓库所对照/衍生的可运行实现**：[AICoderTudou/claude-code-tudou](https://github.com/AICoderTudou/claude-code-tudou)
- **社区中标注的另一上游参考**：[instructkr/claw-code](https://github.com/instructkr/claw-code)

关于本项目中 “普瑞赛斯（Priestess）” 相关的人物设定、艺术风格、世界观表达与命名参考，特此声明：其艺术来源与相关参考均来自**上海鹰角网络科技有限公司 (Hypergryph Network Technology Co., Ltd.)** 旗下游戏作品《**明日方舟**》及其官方衍生内容（包括但不限于官方公开素材、宣传文本与世界观设定）。

---

## ⚠️ 关于权利与合规

以下内容仅为项目说明，**不构成法律意见**；是否合法、如何合规，请你结合所在地法律与相关服务条款**自行判断**，并自担风险。

1. **Anthropic、Claude、Claude Code** 等名称与相关产品为 **Anthropic PBC** 或其关联方的商标或商业标识；**本仓库与 Anthropic 无官方关联、无授权背书**，亦不代表其立场。
2. 上游及社区代码的著作权、许可与分发条件以**各上游仓库的 License 与声明为准**。你在下载、运行、修改、再分发前，应自行阅读并遵守上述文件及适用法律；**因使用本仓库或上游代码产生的任何风险与责任由使用者自行承担**。
3. **由维护者独立编写**的补丁、文档与桌面层等文件的许可范围、免责声明与担保限制，**一律以本仓库根目录 `LICENSE` 文件为准**（由维护者在 GitHub 上维护；若你看到的是未包含该文件的快照或 fork，以你在 GitHub 打开的**默认分支**为准）。该文件**不自动覆盖**你从上游合并或随依赖引入的第三方代码，该部分仍受其各自许可证约束。若根目录 `LICENSE` 与本文任何表述不一致，**以 `LICENSE` 为准**。
4. 若你认为本仓库某部分内容存在权利瑕疵或不宜公开，请通过合法渠道联系维护者，在核实后将积极配合更正、署名或下线处理。

---

## 项目与仓库声明

**本项目为独立开发的个人项目，仅用于学习交流。**

**仅学习传播，禁止一切盈利行为，禁止用于任何生产环境。**
