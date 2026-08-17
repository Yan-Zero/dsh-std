# `@dsh-std/messages` 协议提案

- 文档类型：协议提案
- 状态：草案
- 日期：2026-08-17

## 摘要

`@dsh-std/messages` 定义 `messages.dsh/v1alpha1` `MessageObserver`。该协议允许已授权 Participant 观察消息事件，不允许观察者修改、取消或阻断原消息操作。

消息正文使用与 MCP `ContentBlock` 对齐的 text/image 子集。本文中的“必须”“禁止”“应”“不应”和“可以”分别对应 MUST、MUST NOT、SHOULD、SHOULD NOT 和 MAY。

## 协议坐标

```text
apiVersion: messages.dsh/v1alpha1
kind: MessageObserver
```

Observer 通过 protocol requirement 声明需要 `MessageObserver`。Publisher 通过 protocol support 声明可以在协商作用域中发布该事件。Requirement 与 support 在 `v1alpha1` 中不携带 `spec`。

存在多个候选 Publisher 且组合层没有作出确定选择时，协商必须失败，不能以注册或加载顺序选择事件来源。

## 订阅

Facet 必须在静态 Manifest 中声明 `MessageObserver` subscription。Subscription 可以限制 scope；没有被 Manifest 声明覆盖的 scope 禁止在运行时订阅。

订阅建立时和每次事件投递时都必须检查 `messages.observe.read` grant。Grant 撤销、Facet deactivate、连接关闭或 runtime generation 结束时，相关订阅必须关闭。

Observer 回调的返回值必须被忽略。需要修改或取消消息的协议必须使用独立的 interception 坐标、权限和合成规则，不能扩展 `MessageObserver` 的返回值获得控制权。

## Event envelope

每个事件必须具有以下形状：

```text
MessageEvent {
  eventType: "messages.observe"
  eventVersion: "0.15"
  eventId: string
  scope: string
  sequence: non-negative integer
  privacyClass: "public" | "internal" | "sensitive"
  summary: string
  payload: MessagePayload
}
```

`eventId` 在 Publisher 定义的事件流内必须唯一。`sequence` 在同一 scope 内必须单调递增；允许出现间隔。Consumer 不得把不同 scope 的 sequence 合并成全局顺序。

`summary` 是经过裁剪的人类可读摘要，不替代结构化 payload。它禁止包含凭据、token 或未授权的完整敏感正文。

Envelope 和 payload 在交给 Observer 后必须视为不可变数据。实现可以复制或冻结对象；不得依赖 Observer 自律来保护其他订阅者。

## Message payload

```text
MessagePayload {
  kind: "message.created" | "message.received" | "message.sent"
  messageId?: string
  author?: string
  content: ContentBlock[]
  truncated?: boolean
}
```

`content` 必须至少包含一个 block。`truncated: true` 表示 Publisher 因产品限制、授权或大小边界裁剪了内容。缺少 `truncated` 或值为 `false` 不构成完整性或真实性证明。

## ContentBlock 子集

`v1alpha1` 接受以下与 MCP `ContentBlock` 对齐的子集：

```text
TextContent {
  type: "text"
  text: string
}

ImageContent {
  type: "image"
  data: base64 string
  mimeType: string
}
```

Block 禁止包含所属 variant 未定义的字段。`ImageContent.data` 承载 base64 编码字节；`mimeType` 必须是有效的 media type。实现必须在接纳事件前验证 block，并对消息、block、text 和 image bytes 设置有界限制。

本协议不接受 audio、resource link、embedded resource、任意 URL 或本地文件路径。支持这些内容需要新的兼容协议版本或明确引用其他内容协议。

## Privacy class

- `public`：Publisher 认定可以在当前公开作用域披露；
- `internal`：仅限当前产品或组织信任边界；
- `sensitive`：包含敏感会话信息，必须显式授权。

未知 `privacyClass` 必须拒绝或丢弃，并记录不含 payload 的诊断。实现不得把未知值降级为 `public` 或 `internal`。

`privacyClass` 是最低处理要求，不替代 permission、scope 隔离或产品数据政策。

## 投递语义

`v1alpha1` 提供 live subscription 内的 at-most-once 投递，不保证 replay。Publisher 可以在已声明的资源边界下丢弃事件，但必须保留 sequence 间隔，使 Observer 能识别可能缺失。

同一 subscription 的回调必须串行执行。不同 subscription 可以并发。Publisher 必须规定有界 callback budget；Observer 超时或失败不能阻断原消息操作。实现可以关闭失败订阅或跳过该事件，但必须采用稳定策略并产生不敏感诊断。

本协议不是持久消息队列。需要确认、重放、cursor 或 exactly-once 语义时，必须使用独立协议。

## 错误

实现必须能够稳定区分下列错误：

- `PERMISSION_NOT_GRANTED`：缺少当前 scope 的读取 grant；
- `UNKNOWN_PRIVACY_CLASS`：privacy class 不受支持；
- `INVALID_EVENT_ENVELOPE`：事件不符合 envelope 或 ContentBlock 约束；
- `SUBSCRIPTION_CLOSED`：订阅已经关闭。

错误与普通日志不得包含完整消息正文、图片数据、凭据或 token。

## 安全考虑

Publisher 必须按 session、tenant 和授权 scope 隔离事件，禁止跨 scope 投递。敏感事件默认不得发送。授权检查必须发生在投递时，不能只在 activation 或订阅创建时缓存一次结果。

`MessageObserver` 是只读观察协议，不是沙箱。Trusted in-process Observer 仍可能通过其他进程能力访问数据；产品不得把本协议描述成技术隔离保证。

## 兼容性

增加 ContentBlock variant、改变既有字段、扩大事件 kind、改变 delivery guarantee、赋予 Observer 控制权或改变 privacy class 含义，均属于协议兼容性变更，必须使用新的 `apiVersion`。
