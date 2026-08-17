# `tui.dsh/v1alpha1` Decision Events 协议提案

- 文档类型：协议提案
- 状态：探索性草案
- 日期：2026-08-18

## 摘要

`tui.dsh/v1alpha1` 定义交互式终端 UI 可以向已激活 Component 公开的
`DecisionEvents` 协议。它为会话输入、回退、会话切换和压缩等 UI 发起的
操作定义只读通知与可拦截决策点。

本协议不定义全局 event bus，也不规定终端 renderer、插件框架、会话实现或
具体宿主的内部 hook。它只定义 Consumer 和 Provider 可以协商、授权、注册、
分派和清理的版本化边界。

本文中的“必须”“禁止”“应”“不应”和“可以”分别对应 MUST、MUST NOT、
SHOULD、SHOULD NOT 和 MAY。

## 协议坐标

```text
apiVersion: tui.dsh/v1alpha1
kind: DecisionEvents
```

Consumer 在 Manifest 中以 protocol requirement 声明 `DecisionEvents`。Provider
以 protocol support 声明该坐标。`v1alpha1` requirement 不携带 `spec`；Provider
可以发布下列诊断性 support spec：

```ts
interface DecisionEventsSupport {
  readonly features?: readonly string[]
}
```

`features` 中的每项是本协议定义的 event point 名称。缺少该字段不表示 Provider
可以省略 `v1alpha1` 的必需行为；Consumer 也禁止把未知 feature 当作可用能力。

同一 composition scope 中出现多个 Provider 时，composition 必须使用明确的
选择规则；不得按注册、安装或异步完成顺序选择 Provider。

## Event points

每次分派具有一个 session scope：`session:<session-id>`。Provider 可以接受
`session:*` 作为该 scope 的显式父范围；其他 wildcard、空 scope、无法规范化的
scope 或跨 session 交付均禁止。

| Event point | Mode | Permission | 结果 |
| --- | --- | --- | --- |
| `tui/input` | intercept | `session.input.intercept` | replace、handled、cancel 或 no-opinion |
| `tui/rewind-prompt` | intercept | `session.rewind.intercept` | cancel、附加 rewind mode 或 no-opinion |
| `tui/rewind-done` | observe | 无 | 返回值忽略 |
| `tui/session-switch` | intercept | `session.switch.intercept` | cancel 或 no-opinion |
| `tui/session-switched` | observe | 无 | 返回值忽略 |
| `tui/compact` | intercept | `session.compact.intercept` | cancel 或 no-opinion |

所有 event payload 必须至少带有 `sessionId` 和 `cwd`。`tui/input` 还必须带有
`text` 及 `delivery`（`followup` 或 `steer`）；`tui/rewind-prompt` 必须带有被选中
消息的 `text` 和 `seq`。其余 payload 与 decision 的精确 schema 属于本协议版本的
conformance material；Provider 不得以未验证的任意对象替代这些结构。

Observe point 的 handler 返回值必须忽略。Intercept point 的 handler 只可以返回
该 event point 定义的结构化 decision 或 no-opinion；原始 payload 不是 decision
通道，handler 禁止通过修改 payload 改变原操作。

## 注册与授权

Interceptor 的 Component 必须同时满足以下条件：

- 静态 Manifest requirement 包含 `tui.dsh/v1alpha1#DecisionEvents`；
- 静态 Manifest permission 包含 event point 对应的 permission 和可覆盖当前
  session 的 scope；
- 当前 activation instance 持有该 permission 的有效 grant；
- handler 由当前 activation owner 注册，并附带可复算的稳定 order key。

Provider 必须在注册时和每次分派前检查 grant。撤销 grant、Component deactivate、
session scope 关闭或 runtime generation 结束时，相关 handler 必须移除。已移除的
handler 禁止收到后续 payload。

Observe point 也必须由已协商的 Component activation 注册，并在 deactivate 时移除；
它不因缺少 intercept permission 而获得对其他协议数据的读取权限。

## 分派语义

Provider 必须为每个 handler 建立独立的、不可变 payload view。实现可以复制并冻结
payload，或使用等价隔离机制；禁止把同一个可变对象顺序交给多个 handler。

Intercept handler 按稳定 order key 的 Unicode code-point 升序执行。相同 order key
使用 Component identity，再使用 activation identity 作为确定性 tie-breaker。注册
先后、包安装顺序和 Promise 完成顺序禁止作为 order policy。

每个 handler 必须具有单独 deadline，整个 dispatch 还必须具有总 deadline。Provider
必须公开采用的 deadline 值和 timeout policy。`v1alpha1` 的默认 timeout policy 是：
超时或 handler 异常被记录为不含敏感 payload 的诊断，并作为 no-opinion 继续；总
deadline 到达后跳过其余 handler，原操作按尚未收到有效 decision 时的正常路径继续。

Provider 必须验证每个返回的 decision。无效 decision、超时和异常不能阻断后续
handler。第一个通过当前 event point schema 验证的 decision 获胜；后续 handler
不再执行。Provider 必须在必要时记录获胜 Component、耗时和稳定结果码，但日志和
跨信任域错误禁止包含未清理的 payload、路径、凭据或 stack。

## 生命周期与错误

Provider 至少必须稳定区分以下失败：

- `PERMISSION_NOT_GRANTED`：缺少当前 event point/scope 的有效 grant；
- `DECISION_EVENTS_NOT_REQUIRED`：Component 未静态要求本协议；
- `INVALID_EVENT_POINT`：未知 event point 或不适用于当前 mode；
- `INVALID_DECISION`：handler 返回值不符合 event point 的 result schema；
- `HANDLER_TIMEOUT`：单个 handler 超过其 budget；
- `DISPATCH_TIMEOUT`：整个分派超过总 budget；
- `SUBSCRIPTION_CLOSED`：owner、scope 或 grant 已关闭。

`INVALID_DECISION`、`HANDLER_TIMEOUT` 和 handler 异常按照本协议的 no-opinion
policy 处理；它们不能把未完成的 UI 操作永久挂起。

## 安全考虑

Interception 可以修改或阻断用户意图，默认风险高于 observation。Provider 必须使用
最小 payload、静态声明、scope 检查、可撤销 grant 和 activation ownership；仅在
Component 首次激活时检查授权是不足够的。

`DecisionEvents` 不是 sandbox。受信任的进程内 Component 可能通过其他能力影响
运行时；协议的 permission 和审计语义不能被表述为进程隔离保证。

## 兼容性

改变 event point 名称、payload 或 decision schema、scope 关系、排序、timeout
policy、默认结果或 permission 语义均属于兼容性变更，必须使用新的 `apiVersion`。
新增可选 feature 不得改变不认识该 feature 的 `v1alpha1` Consumer 的既有行为。

旧的产品专属 group 不属于本协议的 alias。Provider 若同时支持旧坐标，必须把它
作为独立、显式的 compatibility profile，禁止在协商中把两个坐标静默视为相同协议。
