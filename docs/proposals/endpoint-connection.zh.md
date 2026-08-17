# `@dsh-std/connection` 设计提案

- 文档类型：设计提案
- 状态：方向已确认，接口草案
- 日期：2026-08-16

## Summary

`@dsh-std/connection` 定义两个 endpoint 如何交换经过连接策略裁剪的协议声明、形成双方一致的 agreement，并在连接存续期间维护这些 agreement。

Connection 使用 `@dsh-std/core` 的协议身份、requirement、support 和 definition。它不读取插件 manifest，不合并产品 registry，也不解释 command、tool、session、agent 或 UI 等业务。

包中可以提供 offer 校验、协商、digest、状态机和 attachment 管理等参考代码。Host、TUI、Web、GUI、Remote SSH 或其他程序分别实现 connector、acceptor、carrier 以及协议的实际业务处理。

## Motivation

同一运行时可能同时连接 TUI、Web 和其他客户端，并向不同连接公开不同协议。静态 manifest 或进程内 live declaration 都不能直接充当连接提议：

- manifest 只表示发行物可能支持什么；
- live declaration 可能包含不应向该 peer 公开的协议；
- 某些本地 requirement 应由当前进程内的实现满足，不应自动发送给对端；
- 协议可能采用唯一实现、多实现、双向角色或功能交集等不同协商规则；
- 双方必须对当前 revision 的结果达成一致，才能开始交换协议消息。

Connection 为一次 endpoint pairing 建立独立 view，使协议声明、连接选择和产品权限保持分离。

## Guide-level explanation

### Endpoint

Endpoint 是参与 connection 的运行实体。它可以是 Host daemon、TUI、Web backend、GUI、远端 agent 或进程内组件。

```ts
interface EndpointIdentity {
  readonly id: string
  readonly instanceId: string
}
```

`id` 标识逻辑 endpoint，`instanceId` 区分一次运行实例。Connection 不规定 endpoint 如何启动，也不要求存在名为 host 的 profile。

### Connection view

Endpoint implementation 针对一条连接创建 view：

```ts
interface EndpointConnectionView {
  readonly endpoint: EndpointIdentity
  readonly offer: ConnectionOffer

  onOfferChange(listener: (offer: ConnectionOffer) => void): () => void
  attach(agreement: ConnectionAgreement): ProtocolAttachments
  close(reason?: string): void | Promise<void>
}
```

View 的输入通常包括本端 live core declarations、已认证 peer identity、composition plan 和 permission policy。怎样取得这些输入属于产品实现。

同一 endpoint 可以为不同 peer 创建不同 view。Connection 标准只看最终 offer，不访问产生 offer 的 plugin registry、service container 或 UI 状态。

### Offer

```ts
interface ConnectionOffer {
  readonly apiVersion: 'connection.dsh/v1alpha1'
  readonly kind: 'ConnectionOffer'
  readonly endpoint: EndpointIdentity
  readonly revision: number
  readonly declarations: readonly ProtocolDeclaration[]
}
```

Offer 中的 declaration 只描述本次连接愿意协商的 requirement 与 support。产品实现必须保证：

- participant 在当前 endpoint view 中存在；
- support 来自当前实际实现，而不是静态 manifest 推断；
- requirement 是本次确实希望由连接参与者满足的需求；
- 声明经过 peer policy 和 permission 裁剪；
- participant identity 在该 offer 内唯一。

这些条件由 view creator 执行。Connection 不反向读取产品内部状态验证它们。

Participant identity 不必包含 component 或 facet provenance。即使本地 participant 来自某个 manifest facet，connection view 也只在相应协议或审计 policy 明确需要时公开这层关联；对端不能把公开的 component/facet 名称当作本地安装身份或授权 principal。

### Negotiation

双方交换完整 offer 后，connection evaluator 将声明交给 core，并为出现在连接范围内的协议调用对应 definition。

协议 definition 决定：

- 哪些 requirement 与 support 可以共同工作；
- 是否允许多个参与者；
- 双方分别承担什么角色；
- 选择哪个协议版本和功能子集；
- agreement 中需要保存哪些协议专属参数。

Connection 汇总协议结果，规范化排序并计算 plan digest。双方必须针对相同的 offer revision tuple 得到同一 digest，再分别接受该 plan。

### Agreement 与 attachment

Connection plan 包含每份已协商协议的 agreement：

```ts
interface ConnectionAgreement {
  readonly apiVersion: 'connection.dsh/v1alpha1'
  readonly kind: 'ConnectionAgreement'
  readonly connectionId: string
  readonly revision: number
  readonly offers: readonly OfferRevision[]
  readonly digest: string
  readonly protocols: readonly NegotiatedProtocol[]
  readonly issues: readonly ConnectionIssue[]
}
```

`NegotiatedProtocol` 记录协议版本、参与者和由协议 definition 生成的 `spec`。Connection 不假定它一定是 consumer/provider binding。

Plan 被双方接受后，每份 negotiated protocol 得到一个 connection-scoped attachment。Attachment 只向 agreement 中列出的本端 participant 签发，并在 plan 替换、连接关闭或 permission 撤销时失效。

### Protocol messages

Connection attachment 为协议实现提供有界、带 revision 的消息通道：

```ts
interface ProtocolAttachment<Message = unknown> {
  readonly connectionId: string
  readonly planRevision: number
  readonly agreementId: string
  readonly signal: AbortSignal

  send(message: Message): void | Promise<void>
  onMessage(listener: (message: Message) => void | Promise<void>): () => void
}
```

Message schema、方向、request id、progress、cancel、stream 和错误语义由所属协议定义，或由该协议明确采用的通用 messaging profile 定义。

Connection 只验证 attachment 是否属于 active/draining plan、消息是否符合协商限制，以及 carrier 是否满足大小和流控要求。它不根据 `operation` 字符串查找产品 handler，也不执行领域请求。

### Implementation examples

不同产品可以实现同一 connection 协议：

- Host daemon 提供 acceptor，把远端 endpoint attachment 接入本机 Agent runtime；
- TUI 提供 connector，并为本地 presentation 协议注册 participant；
- Web backend 同时提供 acceptor 与 connector；
- Remote SSH 负责启动或发现远端 endpoint，再用 SSH channel 承载 connection wire；
- QUIC implementation 可以用独立 stream 承载不同 protocol attachment。

这些实现对 connection definition 声明相同的支持即可协商。领域协议不需要知道实际使用 SSH、WebSocket、HTTP、QUIC 或进程内调用。

## Reference-level explanation

### Connection protocol support

Endpoint 通过 core 声明自己支持的 connection 版本和可选特性。例如 support spec 可以包含可接受的 wire profile、最大 offer 大小、attachment 数和动态 renegotiation 能力。

Core 首先协商 connection 协议本身。只有双方形成 connection agreement 后，才在该协议规定的初始化阶段交换用于其他协议的 `ConnectionOffer`。

这避免把 connection 固化为 core 的内建传输，也允许一个实现同时支持多个 connection 版本或 carrier profile。

### Offer revision

Offer revision 在一个 endpoint view 的生命周期内单调递增。每个 revision 表示完整替换，不依赖对端是否收到更早的增量。

Offer 的 canonical digest 包含 endpoint identity、revision 和规范化 declarations。Canonical encoding 与 hash algorithm由配套 wire proposal 规定。

### Plan calculation

一个 connection 只有一个 negotiation coordinator。第一版由主动连接方担任，但双方独立复算 candidate plan。

协商过程为：

1. coordinator 选择双方确定 revision 的完整 offer；
2. 双方验证 offer 外壳和限制；
3. 双方用同一组 protocol definitions 与显式 connection policy 计算 candidate；
4. 双方比较 offer revision tuple、plan revision 与 digest；
5. 双方发送 accept；
6. 原子激活新 plan 和 attachment set。

Definition 不可用、必需协议缺失、版本不兼容、协议专属协商失败或 digest 不一致都会阻止首次 plan 激活。可选协议缺失保留在 report 中。

### Active and draining plans

每条 connection 至多有一个 active plan。更新时，旧 plan 可以进入 draining：

- 新 attachment 只从 active plan 签发；
- draining attachment 不接纳新的协议工作；
- 已经由领域协议接纳的工作按该协议的 draining/cancel 规则结束；
- deadline 到期后 attachment 被强制关闭；
- 未被双方接受的新 plan 不会替换 active plan。

Connection 不把旧 attachment 的消息自动路由到新 agreement。协议需要会话迁移时必须显式定义迁移标识和重放规则。

### Connector, acceptor and carrier

```ts
interface ConnectionConnector {
  supports(target: ConnectionTarget): boolean
  connect(request: ConnectRequest): Promise<StandardConnection>
}

interface ConnectionAcceptor {
  accept(request: AcceptanceRequest): Promise<EndpointConnectionView>
}
```

Connector 根据 target 建立外向连接。Acceptor 在 carrier 完成认证后，根据经过最小化处理的 peer identity 创建 endpoint view。

多个 connector 同时支持同一 target 时，broker 要求显式选择或返回歧义错误；它不按注册顺序挑选。

Carrier 负责字节或 frame 传递、认证集成、keepalive 与底层断线。Connection wire 负责初始化、offer、plan、accept、protocol message 和 close frame。领域协议只看到 attachment。

### State

```text
connecting -> negotiating -> open
                         -> renegotiating -> open
                         -> closing -> closed
```

`connect()` 在首个 plan 双方接受后返回。关闭是幂等操作，会关闭所有 attachment，并向其 abort signal 传播原因。

物理断开后的 endpoint 或业务 session 恢复不由 connection 自动保证。逻辑重连和协议状态恢复需要明确的 wire 与领域协议支持。

### Flow control

Connection implementation 对 offer、agreement、单条 message、attachment 数和并发消息设置协商上限。

Attachment 必须提供有界发送队列或 credit/window 背压。无法继续缓冲时，发送方收到稳定 flow-control error；实现不能无限积累 progress 或 event 消息。

### Errors

Connection error 至少区分：

- carrier closed 或 transport lost；
- authentication/acceptance failed；
- malformed offer 或 protocol message；
- definition unavailable 或 negotiation failed；
- plan revision unknown/inactive；
- agreement 或 participant 不属于当前 attachment；
- flow control exceeded；
- policy revoked；
- peer protocol violation。

领域协议错误由其 message schema 保留。Connection 不把所有远端失败压缩成一个通用 handler error。

## Security considerations

- Endpoint live support 不会自动成为某条连接的 offer；view creator 按认证 peer 和 policy 选择最小集合。
- 远端声明的 endpoint、participant、component 或 plugin id 都不是本地授权 principal。
- 双方只处理 active/draining plan 中存在的 agreement 和 attachment。
- Attachment handle 由本端 connection implementation 签发，不能由对端发送字符串构造。
- Agreement 表示协议协商成功，不等于 permission grant；实际副作用仍由执行端 adapter 检查。
- 一个 connection 的 revision、attachment 和 message id 不能在另一条 connection 中使用。
- 原始 SSH、TLS、HTTP 或其他 carrier 凭据不进入 core declaration 和领域消息。
- 实现限制协商频率、消息大小、attachment 数、并发和缓冲。

## Drawbacks

每个需要跨端工作的领域协议都要定义自己的 connection agreement 与 message schema，connection 不再提供一个可随意拼 operation 字符串的万能 RPC。

双方独立复算、显式接受和 draining plan 增加了实现复杂度，但能避免两端使用不同协议集合或在更新时错误重路由消息。

Connection view 要求产品实现区分完整 live inventory 与连接公开面。已有全局 RPC server 需要增加 per-connection policy 和 attachment scope。

## Rationale and alternatives

### 直接发送 plugin registry snapshot

Registry 是产品内部组合状态，包含与本连接无关的插件和实现，也可能泄露不应向 peer 公开的信息。Offer 只携带为该连接选择的 core declarations。

### 把所有协议视为 RPC capability

事件、目录同步、双向 presentation 和 streaming 的组合方式不同。Connection 提供 attachment 和消息承载，具体交互由协议定义。

### 在静态 requirement 中加入 locality

同一 component 在单进程和远端连接中可能采用相同 manifest。是否通过连接满足 requirement 由 connection view 的声明选择表达，不写入静态 core requirement。

### 由 carrier 定义业务 API

SSH、WebSocket 或 QUIC implementation 若各自定义 agent/session RPC，客户端会依赖 carrier。Carrier 只承载 connection wire；业务 message 由独立协议拥有。

### 只由 coordinator 计算 plan

如果对端直接接受 coordinator 给出的完整结果，就无法发现 definition 版本、policy 输入或 canonicalization 不一致。双方复算并比较 digest 后才激活。

## Relationship to other proposals

- Core 提供协议声明、definition 分派和通用协商报告；
- Manifest 表达发行物可能使用的协议，不直接进入 connection offer；
- Composition 选择本端 facets；lifecycle activation 产生可进入 connection view 的 participant 与 live support；
- Permission 决定哪些 support 可以向特定 peer 公开，以及 attachment 能执行哪些副作用；
- Lifecycle 拥有 participant 和 attachment handler 的清理 scope；
- 各领域协议定义自己的 connection agreement 和 message schema。

## Unresolved questions

### Wire profiles

第一个跨进程实现合入前需要独立 wire proposal，规定初始化、认证绑定、canonical encoding、frame、重放、乱序、keepalive、limits 和关闭语义。

### Generic messaging profiles

Request/response/progress/cancel 与 event stream 很可能值得成为可复用协议，但它们应是 connection 上的独立 profile，而不是 core 或所有 attachment 的强制形状。

### Logical reconnection

第一版可以重新建立物理 connection 并完整重新协商，不恢复进行中的协议工作。可恢复 connection id、deduplication window 和状态重放需要单独提案。

### Peer identity

Acceptor 需要 transport-neutral、经过认证的 peer identity。哪些字段可以标准化、哪些只能作为 carrier 私有 policy input，需要与 wire 和 permission proposal 一起确定。
