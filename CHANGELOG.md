# Changelog

## 1.0.1 — 2026-11-12

兼容性发布，**无功能变更**。

- 在 DSH `0.2.2-rc.2` 上实测通过：加载、显示正常，**升级无需改代码**。
- 对照官方 `docs/upgrade-guide/v0.2.2-rc.1/`（描述 rc.1 → rc.2）全部 19 条 break，与本插件用到的面相交 **0 条**。
- 复核通过：DOM 契约（`data-conversation-session` / `data-chat-node-key` / `data-chat-call-id` / `data-chat-flow-kind` / `data-chat-group-key` / `data-turn-tail`）、数据 seam（`binding().target('chat')`，rc.2 仅改引号写法、id 未变；快照 `{order, nodes}` 与 `getSnapshot`/`subscribe` 不变）、时间字段（`callTime` / `stepStartTime`）。
- README 兼容性表补充 rc.2。
- 修复：包内 `cordis.patch.yml` 首行误写成 `//`（YAML 里不是注释），会让「把本包装成 bundle」的安装方式解析失败；已改为 `#` 并更新注释措辞。

## 1.0.0 — 2026-11-12

首个发布版本。

- 对话视图**每一行**常显该步**开始时间**（本地时区 `HH:MM:SS`，跨天带 `MM-DD`），统一落在该行块级容器的左上角。
- 覆盖：工具调用行（含嵌套子调用）、assistant 步、Think 行、命令卡、压缩行、user/steering 等单时间节点。
- 每行至多一枚角标；turn 尾部（`turn-tail` / `turn-process`）不插手，沿用宿主自带的时钟。
- 纯客户端实现：`lib/index.js` 为空 `apply(){}`，不注册服务/工具/提示词，无网络请求。
- 数据取用三层可替换适配器，宿主存储路径变化时只需新增一条适配器。
- 测试：`node test/run.mjs`（极简 DOM，覆盖适配器命中、两类时间来源、隐藏行、服务晚到、dispose 清理等）。

### 已验证的 DSH 版本

- DSH `0.2.2-rc.1`（Windows 桌面版）——实测加载、显示与刷新均正常。

### 兼容策略

项目会**持续跟进最新的 DSH release**：每当新版本改动宿主 DOM 契约或会话数据结构时，优先以新增适配器 / 调整选择器常量的方式适配，尽量不改动渲染层与对外行为。适配器与选择器常量集中在 `lib/client.js` 顶部与 `ADAPTERS` 数组，见 README「以后版本对不上时怎么改」。

## 0.1.2

- 修复：思考行的时间落在行内行首而非左上角（角标不再插入折叠头 flex 行，改为锚定块级容器，并加父容器兜底）。

## 0.1.1

- 移除悬停卡片（不再显示结束时间与耗时），只保留开始时间。
- 统一所有行到行头位置。
- 健壮性：条数上限判断改 `undefined`、会话卸载时退订、隐藏行跳过、`<body>` 晚到重试、扫描异常保护、订阅按快照引用去重、适配器重试退避、`aria-hidden`。

## 0.1.0

- 初版：工具行 / assistant 步显示开始时间。
