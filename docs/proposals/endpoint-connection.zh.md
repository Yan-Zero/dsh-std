# `@dsh-std/connection` 设计提案

- 文档类型：设计提案
- 状态：方向已确认，接口草案
- 日期：2026-08-17

## Summary

`@dsh-std/connection` 定义应用如何取得通信能力，以及两个 endpoint 如何交换经过策略裁剪的协议声明、形成双方一致的 agreement，并在连接存续期间维护这些 agreement。

应用通过 `ConnectionService` 请求连接和取得已协商协议的 client。Participant implementation 通过 `ParticipantPublicationService` 加入 Host 管理的 endpoint view。应用不负责监听端口、建立转发、解析 connection wire、保存 transport 凭据或管理重连。Connection Host 实现这些 service，并统一承担资源所有权与生命周期。

Connection 使用 `@dsh-std/core` 的协议身份、requirement、support 和 definition。它不解释 command、tool、session、agent 或 UI 等领域业务，也不要求某一种 carrier、进程拓扑或产品实现。

协议包可以提供 offer 校验、协商、codec、状态机、attachment 和一致性 fixture。`@dsh-std/connection/wire` 定义跨进程 CBOR wire profile。网络监听、进程与端口管理、认证材料、carrier supervision 和产品 policy 由 Connection Host 实现，不由每个 TUI、Web、GUI 或业务插件重复实现。

## Motivation

同一运行时可能同时服务 TUI、Web、GUI 和其他客户端，并向不同连接公开不同协议。静态 manifest 或进程内 live declaration 都不能直接充当连接提议：

- manifest 只表示发行物可能支持什么；
- live declaration 可能包含不应向该 peer 公开的协议；
- 某些 requirement 应由当前进程内的实现满足，不应自动发送给对端；
- 协议可能采用唯一实现、多实现、双向角色或功能交集等不同协商规则；
- 双方必须对当前 revision 的结果达成一致，才能开始交换协议消息。

只规定 endpoint wire 仍然不够。如果每个消费者都要自行选择 connector、开放本地端口、启动 SSH、解析 frame 和处理断线，那么标准只是重复实现之间共享的类型声明。Connection 因此还要规定一个宿主提供、应用消费的 service boundary。

Connection 为一次 endpoint pairing 建立独立 view；Connection Service 则把 endpoint、provider、carrier 和 wire 的实现细节封装在宿主边界内。

## Roles

### Protocol consumer

Protocol consumer 是请求通信能力的应用或 facet，例如 TUI、Web backend、GUI 或业务插件。Consumer：

- 声明自己需要 `connection` 以及要通过连接使用的领域协议；
- 通过标准 SDK 取得 scoped `ConnectionService`；
- 提交目标和本次调用所需的协议选择；
- 通过已协商的 typed client 使用 Command、Session、AgentControl 或 Presentation 等协议。

Consumer 不注册 transport connector，也不接触端口、socket、SSH 参数、HTTP route、WebSocket frame 或 bearer token。

### Participant publisher

Participant publisher 是实际实现或需要领域协议的应用、facet 或进程。它向 Connection Host 提交 live protocol declaration，并为 `supports` 中的协议绑定 implementation endpoint。

同进程 publisher 使用 scoped `ParticipantPublicationService`。独立进程通过本地、已认证的 EndpointConnection 提交自身 declaration；Connection Host 为该连接建立 proxy participant，并把属于它的 protocol attachment 路由回原进程。

Publisher 不选择自己在外部连接中的 participant id，不读取 Host 的完整 registry，也不能要求 Host 把全部 declaration 公开给任意 peer。

### Connection Host

Connection Host 是 `ConnectionService` 的实际实现。它负责：

- 维护 target、route、carrier 和 acceptor provider registry；
- 根据显式 policy 选择唯一 provider；
- 创建并监督监听器、子进程、端口、转发和物理通道；
- 绑定经过认证的 peer identity；
- 执行 connection wire、offer 协商和 attachment 生命周期；
- 应用 permission、连接公开面和资源限制；
- 提供统一的进度、诊断、取消、关闭和重连状态。

标准不规定 Connection Host 的产品名称，也不要求它与 UI、Agent runtime 或远端 daemon 位于同一进程。

### Target provider

Target provider 使 Connection Host 理解某类高层目标，例如 `ssh`、`local`、具名 endpoint 或产品定义的目标。它验证目标并产生宿主可执行的 route plan。QUIC、WebSocket 等传输选择属于 route/carrier，不因使用某种 transport 就成为用户目标 kind。

Target provider 不向应用暴露 carrier 细节。SSH 集成可以贡献 target 解析、远端发现和 bootstrap 规则，但不因此成为 SSH 协议、connection wire 或远端业务 endpoint 的实现。

### Carrier provider

Carrier provider 在 Connection Host 的监督下建立经过认证的字节或 frame 通道。OpenSSH、QUIC、IPC、stdio、HTTP 或 WebSocket adapter 都可以成为 carrier implementation。

Connection Host 对 carrier 的资源和生命周期负责。具体加密、拥塞控制或 SSH 实现可以委托给系统程序或独立库，不要求 Host 自行重写。

### Endpoint and participant

Endpoint 是参与一次 connection pairing 的逻辑运行实体。Participant 是该 endpoint view 中参与协议协商的实体。

TUI 可以发布 terminal presentation participant，但这不表示 TUI 自己实现 Connection Host 或 carrier。宿主可以代表该 activation scope 把 participant 纳入本端 endpoint view，并向 TUI 签发受限的协议 facade。

## Protocol declarations

Connection family 使用不同的 `kind` 区分消费面、扩展面和 endpoint wire。声明其中一项不能推断实现了其他项：

| `apiVersion` | `kind` | Consumer | Provider |
| --- | --- | --- | --- |
| `connection.dsh/v1alpha1` | `ConnectionService` | TUI、Web、GUI、业务 facet | Connection Host |
| `connection.dsh/v1alpha1` | `ParticipantPublicationService` | 领域协议实现、应用 facet | Connection Host |
| `connection.dsh/v1alpha1` | `ConnectionTargetProvider` | Connection Host | SSH 等 target facet |
| `connection.dsh/v1alpha1` | `ConnectionCarrierProvider` | Connection Host | IPC、OpenSSH、QUIC 等 carrier facet |
| `connection.dsh/v1alpha1` | `ConnectionAcceptorProvider` | Connection Host | listener/acceptor facet |
| `connection.dsh/v1alpha1` | `EndpointConnection` | Endpoint runtime | Endpoint runtime |

应用的静态 manifest 可以要求 `ConnectionService` 和需要时的 `ParticipantPublicationService`；运行时 participant publication 再提交当前实际可用的 Presentation support。静态格式将来即使能够声明潜在 support，也不能代替 live publication。SSH target facet 对 `ConnectionTargetProvider` 发布 support；它不会因为名称中包含 connection 就获得 listener、carrier 或 endpoint 权限。

Connection Host 可以同时发布上述多项 support。每项 support 的 `spec` 分别声明 service facade 版本、可处理 target kinds、carrier properties 或 wire profiles，由对应 definition 独立校验和协商。

## Service interfaces

### Consumer API

应用面向 `ConnectionService`，而不是 connector registry：

```ts
interface ConnectionService {
  connect(request: ConnectionRequest): Promise<ConnectionHandle>
  observe(listener: (event: ConnectionEvent) => void): () => void
}

interface ConnectionRequest {
  readonly target: ConnectionTarget
  readonly protocols?: readonly ApiReference[]
  readonly signal?: AbortSignal
}

interface ConnectionHandle {
  readonly id: string
  readonly state: ConnectionState
  readonly remote: EndpointIdentity
  readonly agreement: ConnectionAgreement

  close(reason?: string): Promise<void>
}
```

`ConnectionService` facade 在签发时已经绑定 activation、UI session、proxy participant 或其他调用边界。Consumer 不提交 scope、plugin id 或完整本地 registry。Host 根据 facade binding、composition、permission 和 peer policy 生成本端 view。

领域协议包或 SDK 根据 `ConnectionHandle` 中已经形成的 agreement 签发 typed client。普通 consumer 不需要直接发送 raw attachment message。

### Participant publication

同进程 implementation 面向 `ParticipantPublicationService`，而不是 Connection Host 的私有 registry：

```ts
interface ParticipantPublicationService {
  publish(request: PublishParticipantRequest): Promise<ParticipantLease>
}

interface PublishParticipantRequest {
  readonly declaration: Omit<ProtocolDeclaration, 'participant'>
  readonly endpoint: ParticipantImplementationEndpoint
}

interface UpdateParticipantRequest {
  readonly expectedRevision: number
  readonly declaration: Omit<ProtocolDeclaration, 'participant'>
  readonly endpoint: ParticipantImplementationEndpoint
}

interface ParticipantImplementationEndpoint {
  attach(input: {
    readonly protocol: ApiReference
    readonly agreement: NegotiatedProtocol
    readonly attachment: ProtocolAttachment
  }): void | Promise<void>
}

interface ParticipantLease {
  readonly participant: ParticipantIdentity
  readonly revision: number
  readonly signal: AbortSignal

  update(request: UpdateParticipantRequest): Promise<number>
  close(reason?: string): Promise<void>
}
```

`ParticipantPublicationService` facade 在签发时绑定 activation/process scope。Host 根据该 binding 分配 participant identity，并校验每项 support 都有对应的类型化 implementation binding。Publisher 不能提交 scope、自选 participant id，也不能只声明 support 而没有处理 attachment 的 endpoint。

Update 是 declaration 与 implementation set 的原子完整替换。成功后 revision 单调递增；失败保留原 publication。Host 根据受影响的 endpoint view 和 peer policy 决定是否产生 offer revision，不能把尚未绑定 implementation 的中间状态公开。

Lease 绑定 activation/process lifetime。Scope 结束、publisher 停用、进程断开或 `close()` 会撤销 declaration，并关闭属于该 participant 的 attachment。静态 manifest 和已安装 package 只能说明可能支持，不能代替 live publication。

`ParticipantImplementationEndpoint` 由各领域协议的 SDK binder 构造。它只接受 agreement 中指向该 participant 的 attachment，并把 attachment 交给对应的类型化 implementation；不存在一个按任意 method string 调用产品对象的通用 dispatcher。

### Out-of-process participant

独立 TUI、GUI 或其他应用进程通过本地、已认证的 EndpointConnection 接入 Connection Host。该进程在自身 offer 中提交 requirement、support 和 implementation attachment；Host 为连接存续期创建 proxy participant。

本地连接协商 `ConnectionService` 后，应用取得与同进程 API 等价、已经绑定自身 proxy participant 的 scoped client。Host 可以把经过 policy 选择的 requirement/support 投影到外部 endpoint view：

```text
application participant
  │ local authenticated EndpointConnection
  ▼
Connection Host proxy participant
  │ selected declaration federation
  ▼
external EndpointConnection
```

外部 attachment 指向 proxy participant 时，Host 建立与本地 connection attachment 的受限 relay。Request、response、cancel、flow control 和关闭在两条 attachment 之间传播；Host 不解释领域 payload。

Federation 不是 registry forwarding。Host 只投影调用 scope 选择且 peer policy 允许的 declaration，并为外部 view 分配 participant identity。外部 peer 不能借此枚举本地进程、manifest facet 或未公开 capability。

本地 carrier 必须认证调用进程或用户，并把认证结果绑定到 scope。Unix socket、named pipe、inherited stdio 或其他 IPC 可以承载同一 connection wire；默认地址、daemon discovery 和进程启动命令属于产品分发，不改变服务 API。

### Target

`ConnectionTarget` 表示用户或上层 policy 想连接的位置，不表示已经建立的物理通道：

```ts
interface ConnectionTarget {
  readonly kind: string
  readonly spec: unknown
}
```

Target 的 `spec` 由相应 target definition 校验。标准不规定所有目标都能表示为 URL，也不要求 SSH、QUIC 和本地进程共享一组伪通用字段。

同一 target 可以因配置和 policy 产生不同 route，例如通过现有 daemon、SSH bootstrap、代理跳转或本地 IPC。Route 属于 Connection Host 的内部计划，不进入领域协议，也不暴露给 consumer。

### Provider SPI

Connection Host 可以通过 provider SPI 扩展目标和 carrier：

```ts
interface ConnectionTargetProvider {
  readonly id: string
  readonly targetKinds: readonly string[]

  resolve(
    target: ConnectionTarget,
    context: TargetResolutionContext,
  ): Promise<ResolvedConnectionRoute>
}

interface ConnectionCarrierProvider {
  readonly id: string
  readonly routeKinds: readonly string[]

  open(
    route: ResolvedConnectionRoute,
    context: CarrierContext,
  ): Promise<AuthenticatedChannel>
}

interface ConnectionAcceptorProvider {
  readonly id: string
  listen(request: ListenRequest, context: AcceptorContext): Promise<ConnectionListener>
}
```

这些是 Host implementation SPI，不是普通插件或 UI 的消费 API。Provider context 只包含已授权的进程、凭据、端口分配、存储和诊断能力；provider 不能从产品 root context 任意取得资源。

多个 provider 同时声称能够处理同一 target 或 route 时，Connection Host 必须根据显式 policy 选择，或返回歧义错误。注册顺序不能成为仲裁规则。

### Provider publication

Provider 通过 connection 协议的标准 publication API 注册，不查询某个 Connection Host、service container 或 UI 的私有 registry。静态 component metadata 若支持 provider contribution，只能声明可能范围；facet 在 activation 时仍通过 scoped SDK 发布实际实现：

```ts
context.protocols.implement(connectionTargetProvider, sshTargetProvider)
```

Publication 绑定 component、facet 和 activation instance owner，并随 lifecycle scope 原子生效和撤销。Connection Host 只从当前 composition 接纳的 live supports 建立 provider view。安装了 provider 包、存在静态声明或能够 import 其入口，都不等于当前可用于连接。

Target provider 可以通过 Host 签发的受限 resource facade 请求进程执行、凭据读取、端口分配或远端 bootstrap。实际资源 handle 由 Host 持有并登记 cleanup；provider disposal 或连接关闭时，Host 不依赖 provider 自行记住并清理每个子资源。

### SSH-routed connection

一次 TUI 远端连接可以按以下方式完成：

```text
terminal application
  │ ConnectionService.connect({ target: sshTarget })
  ▼
local Connection Host
  │ 选择 SSH target provider
  │ 通过受管 SSH/进程能力发现或启动 remote Connection Host
  │ 取得并监督 authenticated channel
  │ 执行 connection wire 与协议协商
  ▼
remote Connection Host / Acceptor
  │
  └─ AgentControl / SessionCatalog / WorkspaceCatalog / UserInteraction agreements
```

TUI 不会收到本地转发端口、SSH control socket、transport credential 或 carrier URL。SSH target facet 不定义 agent/session RPC，也不实现远端业务 endpoint；它只贡献 SSH 场景所需的 target resolution 与 bootstrap 集成。物理 SSH 可以由系统 OpenSSH 或其他 provider 实现。

### Endpoint view

Connection Host 针对一条连接创建 view：

```ts
interface EndpointIdentity {
  readonly id: string
  readonly instanceId: string
}

interface EndpointConnectionView {
  readonly endpoint: EndpointIdentity
  readonly offer: ConnectionOffer

  onOfferChange(listener: (offer: ConnectionOffer) => void): () => void
  attach(agreement: ConnectionAgreement): ProtocolAttachments
  close(reason?: string): void | Promise<void>
}
```

View 的输入包括 ParticipantPublicationService 与本地 EndpointConnection 提交的 live declarations、经过认证的 peer identity、调用者 scope、composition plan 和 permission policy。产品 adapter 可以发布内建 participant，但不能绕过 publication ownership 和 lease 直接向 offer 插入未绑定 implementation 的 support。

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

Offer 中的 declaration 只描述本次连接愿意协商的 requirement 与 support。Connection Host 必须保证：

- participant 在当前 endpoint view 中存在；
- support 来自当前实际实现，而不是静态 manifest 推断；
- requirement 是当前 consumer scope 确实希望由连接参与者满足的需求；
- 声明经过 peer policy 和 permission 裁剪；
- participant identity 在该 offer 内唯一。

Participant identity 不必包含 component 或 facet provenance。即使本地 participant 来自某个 manifest facet，connection view 也只在相应协议或审计 policy 明确需要时公开这层关联；对端不能把公开的 component/facet 名称当作本地安装身份或授权 principal。

### Negotiation

双方交换完整 offer 后，connection evaluator 将声明交给 core，并为出现在连接范围内的协议调用对应 definition。协议 definition 决定：

- 哪些 requirement 与 support 可以共同工作；
- 是否允许多个参与者；
- 双方分别承担什么角色；
- 选择哪个协议版本和功能子集；
- agreement 中需要保存哪些协议专属参数。

Connection 汇总协议结果，规范化排序并计算 plan digest。双方必须针对相同的 offer revision tuple 得到同一 digest，再分别接受该 plan。

### Agreement and attachment

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

Connection runtime 只验证 attachment 是否属于 active/draining plan、消息是否符合协商限制，以及 carrier 是否满足大小和流控要求。它不根据任意 `operation` 字符串查找产品 handler，也不执行领域请求。

## Connection state and semantics

### Connection protocol support

Connection Host 通过 core 声明自己实际支持的 connection 版本和可选特性。Support spec 可以包含可接受的 wire profile、最大 offer 大小、attachment 数、动态 renegotiation、provider discovery 和 consumer facade 版本。

只安装 `@dsh-std/connection` definition 不构成 live support。必须存在可接受 `ConnectionService` 请求并拥有相应资源生命周期的实现，才能发布 service support。

### Offer revision and plan calculation

Offer revision 在一个 endpoint view 的生命周期内单调递增。每个 revision 表示完整替换，不依赖对端是否收到更早的增量。

一个 connection 只有一个 negotiation coordinator。第一版由主动连接方担任，但双方独立复算 candidate plan：

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

### State and observation

```text
resolving -> preparing -> connecting -> authenticating -> negotiating -> open
                                                           -> renegotiating -> open
        \-------------------------------------------------> closing -> closed
```

Provider-specific progress 必须规范化为稳定的 ConnectionEvent；UI 可以显示阶段和诊断，但不能依赖某个 provider 的私有子进程输出。

`connect()` 在首个 plan 双方接受后返回。关闭是幂等操作，由 Connection Host 逆序释放 attachment、wire、carrier、forward、listener、临时凭据与子进程。

### Flow control

Connection implementation 对 offer、agreement、单条 message、attachment 数和并发消息设置协商上限。

Attachment 必须提供有界发送队列或 credit/window 背压。无法继续缓冲时，发送方收到稳定 flow-control error；实现不能无限积累 progress 或 event 消息。

### Errors

Connection error 至少区分：

- target unknown、provider unavailable 或 provider ambiguous；
- route/bootstrap failed；
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

- Consumer 只能使用 Host 为 activation/invocation scope 签发的 `ConnectionService`；不能传入 plugin id 换取其他 participant 的连接公开面。
- Publisher 只能使用 Host 为 activation/process scope 签发的 `ParticipantPublicationService`；不能自选 participant identity 或发布没有 implementation binding 的 support。
- Target provider 与 carrier provider 只能取得声明、协商并授权后的 Host resource facade。
- Endpoint live support 不会自动成为某条连接的 offer；Connection Host 按认证 peer 和 policy 选择最小集合。
- 远端声明的 endpoint、participant、component 或 plugin id 都不是本地授权 principal。
- 双方只处理 active/draining plan 中存在的 agreement 和 attachment。
- Attachment handle 由本端 Connection Host 签发，不能由对端发送字符串构造。
- Agreement 表示协议协商成功，不等于 permission grant；实际副作用仍由执行端 adapter 检查。
- 原始 SSH、TLS、HTTP 或其他 carrier 凭据不进入 core declaration、consumer API 和领域消息。
- Connection Host 限制协商频率、消息大小、attachment 数、并发、缓冲、端口和子进程资源。

## Rationale and alternatives

### 由每个 UI 实现 connector

这样会让每个 TUI、Web backend 和 GUI 重复处理端口、认证、wire、重连与 provider 选择，也会使新增 SSH、QUIC 或代理方式时必须修改所有应用。Consumer-facing `ConnectionService` 把这些职责收敛到 Host。

### 让 SSH target provider 成为完整 carrier 和业务 host

SSH target provider 只需要解释 target 与 bootstrap 策略。SSH 实现、connection wire、远端业务 endpoint 和领域 API 可以分别由系统 provider、Connection Host 和领域 adapter 提供。

### 直接发送 plugin registry snapshot

Registry 是产品内部组合状态，包含与本连接无关的插件和实现，也可能泄露不应向 peer 公开的信息。Offer 只携带为该连接选择的 core declarations。

### 把所有协议视为 RPC capability

事件、目录同步、双向 presentation 和 streaming 的组合方式不同。Connection 提供 attachment 和消息承载，具体交互由协议定义。

### 在静态 requirement 中加入 locality

同一 component 在单进程和远端连接中可能采用相同 manifest。是否通过连接满足 requirement 由 Connection Host 生成的 view 表达，不写入静态 core requirement。

### 由 carrier 定义业务 API

SSH、WebSocket 或 QUIC implementation 若各自定义 agent/session RPC，客户端会依赖 carrier。Carrier 只提供经过认证的通道；connection wire 与业务 message 分别由 connection 和领域协议拥有。

### 只由 coordinator 计算 plan

如果对端直接接受 coordinator 给出的完整结果，就无法发现 definition 版本、policy 输入或 canonicalization 不一致。双方复算并比较 digest 后才激活。

## Drawbacks

Connection Host 的职责比一个简单 connector registry 更重。实现需要同时处理 provider ownership、资源监督、连接公开面和协议协商；相应复杂度集中在少量 Host implementation，而不是扩散到每个应用。

当 consumer 与 Connection Host 不在同一进程时，需要额外的本地 EndpointConnection 和 proxy participant relay。Host 必须同时传播 attachment lifecycle、cancel 与 flow control，不能退化为暴露全部内部 RPC。

Target provider 所需的进程、凭据、端口和 bootstrap resource 不一定都已有可移植协议。缺失时应增加对应 Host resource contract，或把实现明确限定为某个产品 adapter；不能让 provider 回退到任意 root context。

## Relationship to other proposals

- Core 提供协议声明、definition 分派和通用协商报告；
- Manifest 表达 facet 对 `ConnectionService`、`ParticipantPublicationService`、target provider 或领域协议的静态要求与支持；
- SDK 向 consumer 提供 scoped Connection Service、Participant Publication Service 和 typed domain clients/implementations；
- Composition 选择 Connection Host、providers 与本端 facets，不能按注册顺序仲裁；
- Lifecycle 拥有 service、provider、participant 和 attachment 的清理 scope；
- Permission 决定 consumer 能连接哪些 target、provider 能取得哪些 Host resources，以及哪些 support 可以向 peer 公开；
- 各领域协议定义自己的 agreement 和 message schema；
- Connection Wire Profile 定义跨进程 Hello、offer、plan、attachment、flow control 与关闭；
- 产品 adapter 把 Host service、provider SPI 和领域 attachment 映射到实际运行时。

## Unresolved questions

### Generic messaging profiles

Request/response/progress/cancel 与 event stream 很可能值得成为可复用协议，但它们应是 connection 上的独立 profile，而不是 core 或所有 attachment 的强制形状。

### Logical reconnection

第一版可以重新建立物理 connection 并完整重新协商，不恢复进行中的协议工作。可恢复 connection id、deduplication window 和状态重放需要单独提案。

### Peer identity

Acceptor 需要 transport-neutral、经过认证的 peer identity。哪些字段可以标准化、哪些只能作为 carrier 私有 policy input，需要与 wire 和 permission proposal 一起确定。
