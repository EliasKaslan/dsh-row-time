# dsh-row-time

对话（conversation）视图里**每一行**在**行头**常显该步的**开始时间**（本地时区 `HH:MM:SS`，跨天带 `MM-DD`）。
只有开始时间，没有悬浮卡片、没有耗时。

纯客户端插件：`lib/index.js` 是空 `apply(){}`，宿主侧不加任何服务、工具或提示词，无网络请求。

## 兼容性

| DSH 版本 | 状态 |
| --- | --- |
| `0.2.2-rc.1` | ✅ 实测通过（Windows 桌面版）——加载、显示、刷新正常 |
| `0.2.2-rc.2` | ✅ 实测通过——**升级无需改代码** |

`0.2.2-rc.1 → 0.2.2-rc.2` 的官方升级指南（`docs/upgrade-guide/v0.2.2-rc.1/`）共 19 条 break，逐条对照后与本插件用到的面**无交集**。实际复核结果：

- **DOM 契约仍在**：`data-conversation-session`、`data-chat-node-key`、`data-chat-call-id`、`data-chat-flow-kind`、`data-chat-group-key`、`data-turn-tail`
- **数据 seam 仍在**：`uiConversation.binding(binding).target('chat')`（rc.2 内部把引号写法改成了模板字符串，**target id 未变**）；快照仍是 `{ order, nodes.get(key) }`，`getSnapshot`/`subscribe` 接线不变
- **时间字段仍在**：`callTime`、`stepStartTime`

- **兼容策略**：本项目会**积极跟进最新的 DSH release**。宿主改动 DOM 契约或会话数据结构时，优先以「新增一条取数适配器 / 调整顶部选择器常量」的方式适配，不改渲染层与对外行为，因此升级通常只需少量代码或不需改动。
- 声明的最低版本是 `0.2.2-rc.1`（不设上限，便于跟随后续 release）。若未来某个版本出现角标不显示，见下文「以后版本对不上时怎么改」。

## 它显示在哪

任何行都统一放在**该行块级容器的左上角**（插成容器的第一个子节点）。

| 行 | 锚点（块级容器） | 取哪个时间 |
| --- | --- | --- |
| 对话节点行（assistant 步、Think、命令卡…） | `[data-chat-node-key]` flow item | 该节点的 `stepStartTime` / `data.time` |
| 工具调用行（含嵌套子调用） | `[data-chat-call-id]` 行容器 | `data.root.callTime`（运行中回退 `time`） |
| 没有块级 flow item 的行（如 step-process 组里的折叠头） | 折叠头的**父容器** | 最近的 `data-chat-node-key` 祖先 |

**绝不**把角标插进 `[data-disclosure-row]` 折叠头：那是一行横排 flex，插进去会跟标题同一行（这正是 0.1.1 的缺陷）。
每一行只允许一枚角标（`hasBadgeAbove` 保证），turn 尾部（`turn-tail` / `turn-process`）完全不插手——宿主自己已经在那里印了时间。

没有可用时间的行**不加任何东西**（不显示 `--:--`，也不报错）。

## 怎么拿到时间（这决定它能不能跨版本活下来）

三层，从稳定到易变：

1. **DOM 定位**：只用宿主自己写的语义属性，不用 CSS 类名
   - `[data-conversation-session]` → 当前会话 id
   - `[data-chat-node-key]` / `[data-chat-flow-kind]` → 节点身份与类型
   - `[data-chat-call-id]` → 工具调用 id
2. **数据订阅**：`uiConversation.binding(binding).target('chat')` → `getSnapshot()` / `subscribe()`，
   快照形状 `{ order: string[], nodes: Map<key, node> }`
3. **字段读取**：`node.kind` / `node.data`，时间字段 `callTime` / `time` / `timing.stepStartTime`
   —— 这些是**落盘的引擎数据模型**，改 UI 不会动它们。

### 以后版本对不上时怎么改（预期只需动一处）

`lib/client.js` 里的 `ADAPTERS` 是按序尝试的取数函数数组：

```js
var ADAPTERS = [
  function uiConversationTarget(ctx, sessionId) { /* 0.2.x：binding().target('chat') */ },
  function sessionChatSnapshot(ctx, sessionId) { /* 0.1.x：session.getSnapshot().chat */ }
];
```

- 新版本把 chat 存储挪了 → **在数组头部加一个适配器**，其余代码不用碰。
- 字段改名 → 只改 `startOfNode()` 里的字段名。
- 属性改名 → 只改顶部 `SEL_*` 常量。

渲染层是纯 DOM（不接管、不替换任何宿主 React 组件），所以宿主重渲染最多把角标刷掉，观察器会补回来。

## 安装（本机当前形态）

```powershell
# 源码目录做成 junction 挂进 profile
cmd /c mklink /J %USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-row-time D:\workspace\agent\dsh-row-time
```

然后在 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` 里声明行（热生效，不用重启）：

```yaml
- insert:
    - id: row-time
      name: 'dsh-row-time'
```

刷新页面即生效。

> ⚠️ **不要两种挂载方式同时用**：本包同时声明了 `dsh.bundle.patch`，所以也可以把它登记进 profile 的 `dsh.profile.bundles`（这种方式需要重启宿主才生效）。但**同一模块既有 bundle 登记、又在 `cordis.patch.yml` 里手写 `- insert:`** 时，插件管理器会因为"候选行不唯一"把它标成 `unaddressable`——插件照常工作，只是管理界面里无法再开关这一行。二选一即可。

## 自检

浏览器控制台：

```js
__dshRowTime.version          // "1.0.0"
__dshRowTime.badges()         // 当前页面上角标数量，0 = 没取到数
__dshRowTime.index()          // { byKey: Map, byCall: Map }，看索引里有没有东西
__dshRowTime.rescan()         // 手动重扫
```

- `badges()` > 0 但界面看不到 → 角标被插到不可见容器里，报 `data-placement` 排查。
- `index()` 为空 → 取数适配器没命中，按 need `ADAPTERS` 顺序加一条。

## 卸载

```powershell
# 1) 删掉 cordis.patch.yml 里那段 - insert: row-time
# 2) 去掉 junction（只删链接，源码目录不动）
cmd /c rmdir %USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-row-time
```

## 测试

```powershell
cd D:\workspace\agent\dsh-row-time
node test/run.mjs
```

用极简 DOM 跑真实 bundle：适配器命中、两种时间来源、缺服务不抛错、dispose 清理干净。
