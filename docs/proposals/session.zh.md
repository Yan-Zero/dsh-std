# `@dsh-std/session` 设计提案

- 文档类型：设计提案
- 状态：草案
- 日期：2026-08-17

## Summary

`@dsh-std/session` 定义持久 Session 的 identity、目录、历史读取和事件 vocabulary。Session 是可以脱离活动 Agent 存在的持久记录；客户端可以列出、读取、观察和管理 Session，而不取得 Agent 执行能力。

TypeScript 包使用 subpath 区分共享对象、目录、历史和事件声明：

```ts
import { type SessionReference } from '@dsh-std/session'
import { sessionCatalogProtocol } from '@dsh-std/session/catalog'
import { sessionHistoryProtocol } from '@dsh-std/session/history'
import { type SessionEventSpec } from '@dsh-std/session/events'
```

协议 identity 为：

| `apiVersion` | `kind` | 含义 |
| --- | --- | --- |
| `session.dsh/v1alpha1` | `SessionCatalog` | Session 目录、元数据和可选管理操作 |
| `session.dsh/v1alpha1` | `SessionHistory` | Session event 读取、跟随和 fork |
| `session.dsh/v1alpha1` | `SessionEvent` | 具名持久事件类型 resource |

三者共享一个 npm 包和版本域，但可以分别声明、实现、协商和授权。

Session 协议不控制活动 Agent，不解释 Workspace 路径，不执行工具，也不规定会话列表和对话界面的布局。

## Motivation

Session 同时被 Agent runtime、TUI、Web、GUI、导出器、索引器和自动化工具使用。只暴露某个产品的内存对象或日志目录会产生以下问题：

- 客户端把文件布局、事件 class 或数据库 schema 当作协议；
- 远端读取无法表达一致 snapshot、分页 cursor 和增量跟随；
- 未知插件事件无法判断应当阻止重放还是可以跳过；
- rename、delete 和 fork 容易被误解为 UI 操作或文件复制；
- 只读历史客户端被迫取得 Agent 或底层存储权限。

SessionCatalog 提供稳定目录。SessionHistory 提供只读事件流和显式 fork。SessionEvent resource 让组件声明自身事件的 schema 与重放要求。

## Roles

### Session provider

Session provider 拥有 Session identity、目录 revision、持久历史和 cursor。它可以分别发布 `SessionCatalog`、`SessionHistory` support。

同一 endpoint 可以存在多个 provider。每份 agreement 明确记录 provider 和 `sessionDomain`；客户端不能按裸 id 在不同 provider 之间搜索。

### Session client

Session client 使用目录或历史协议。只实现 Catalog 的客户端可以展示 Session 元数据，但不能据此读取事件。只实现 History 的客户端必须从已授权来源取得 SessionReference，不能构造任意 id。

### Event owner

Event owner 通过 `SessionEvent` resource 声明一种具名持久事件。声明 resource 不授予向任意 Session 写入事件的能力；写入仍由拥有 Session mutation 的 runtime 控制。

## Shared model

### SessionReference

```ts
interface SessionReference {
  readonly provider: string
  readonly id: string
}
```

`provider` 是当前 agreement 中的 Session provider participant identity。`id` 在该 provider incarnation 内唯一，并且不是日志路径、Agent id 或 bearer credential。

Reference 用于寻址。每次调用仍检查 agreement、client scope、permission 和 Session 状态。远端给出的 provider 或 Session id 不能成为本地授权 principal。

### Session domain

Catalog 与 History support 声明 `sessionDomain`。History 只有在其 agreement 选中的 provider 与 `SessionReference.provider` 相同、domain 相同且协议协商明确接受时，才能读取 Catalog 返回的 SessionReference。Domain 相同不授权另一个 participant 代替 reference owner 提供历史。

Domain id 只在当前 endpoint view 中用于关联协议，不是跨安装的全局名称。

### Cursor values

```ts
type SessionCursor = string
type SessionPageCursor = string
```

两种 cursor 都是 Provider 生成的非空 opaque string。SessionCursor 定位某份历史中的事件；SessionPageCursor 定位某次 Catalog snapshot 的分页位置。它们不能互换。

### SessionDescriptor

```ts
interface SessionDescriptor {
  readonly session: SessionReference
  readonly title?: string
  readonly state: 'available' | 'unavailable'
  readonly revision: number
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly lineage?: SessionLineage
}

interface SessionLineage {
  readonly parent: SessionReference
  readonly through?: SessionCursor
}
```

Session descriptor 不携带 Workspace membership 或 Workspace provenance。当前分组、手动顺序与归属由 `WorkspaceSessions` 独立表示；Session provider 不根据 cwd、历史字段或创建参数推断 membership。

`revision` 只描述 Session descriptor。History cursor 和 Catalog revision 使用各自的版本空间，数字之间不能比较先后。

## `SessionCatalog`

### Declaration

```ts
type SessionCatalogOperation =
  | 'list'
  | 'get'
  | 'create'
  | 'rename'
  | 'delete'
  | 'watch'

interface SessionCatalogRequirementSpec {
  readonly operations: readonly SessionCatalogOperation[]
  readonly optionalOperations?: readonly SessionCatalogOperation[]
  readonly sessionDomain?: string
  readonly mutationConcurrency?: 'serialized' | 'revision-checked'
}

interface SessionCatalogSupportSpec {
  readonly sessionDomain: string
  readonly operations: readonly SessionCatalogOperation[]
  readonly mutationConcurrency: 'serialized' | 'revision-checked'
  readonly limits?: SessionCatalogLimits
}

interface SessionCatalogLimits {
  readonly maxPageSize?: number
  readonly maxWatchBuffer?: number
}
```

`operations` 中的每一项都必须由 agreement 满足。Create、rename 和 delete 均为可选能力；只读 provider 可以只发布 list、get 和 watch。

`serialized` Provider 按接纳顺序提交 mutation，不接受 revision precondition；收到 `expectedRevision` 必须拒绝请求。`revision-checked` Provider 可以在同一 mutation 临界区校验 `expectedRevision`。Requirement 只有显式要求 `revision-checked` 时才排除 serialized provider。

### List

```ts
interface ListSessionsInput {
  readonly after?: SessionPageCursor
  readonly limit?: number
}

interface SessionCatalogPage {
  readonly catalogRevision: number
  readonly sessions: readonly SessionDescriptor[]
  readonly next?: SessionPageCursor
}
```

List 返回当前 client scope 可见的 Session。默认顺序为 `createdAt` 逆序；时间相同或缺失时按规范化 SessionReference 排序。Provider 可以支持额外 order，但不能把进程内 map 顺序当作稳定结果。

Page cursor 不透明，并绑定 provider、client scope、order 和 catalog revision。Client 不能修改、拼接或跨 agreement 复用 cursor。

Provider 返回的 sessions 数量不得超过请求的 `limit` 或 agreement 的 `maxPageSize`，取两者中较小者。

目录在分页期间发生变化时，Provider 保持原 snapshot，或返回 catalog-invalidated；不能在同一次分页中静默混合两个 revision。

按 Workspace 分组或筛选时，client 使用 WorkspaceSessions 的 membership snapshot；SessionCatalog 不用 cwd 或 descriptor provenance 猜测当前分组。

### Get

Get 按 SessionReference 返回当前 descriptor。Reference 属于其他 provider、domain 或 agreement 时返回 reference mismatch；不存在与无权观察按照 disclosure policy 返回稳定、不可混淆的结果。

### Create

```ts
interface CreateSessionInput {
  readonly title?: string
  readonly requestId: string
}

interface CreateSessionResult {
  readonly session: SessionDescriptor
}
```

Create 建立一份空的持久 Session，不隐含创建或启动 Agent。Provider 不支持独立空 Session 时不发布 create operation；客户端可以改由 AgentControl 的 create 流程取得 Agent 及其 SessionReference。

`requestId` 在当前 client scope 内提供幂等重试。相同 request id 与相同输入返回同一结果；相同 id 与不同输入返回 conflict。

Create 不接受 WorkspaceReference，也不隐式建立 Workspace membership。需要归属的 client 必须（MUST）先协商具有相容 `sessionDomain` 的 `WorkspaceSessions` agreement，再显式调用 attach。这是两次独立提交，不构成跨协议事务；attach 失败时，client 必须保留已创建 Session 的 reference 以便重试、显示或执行经授权的补偿。

### Rename

```ts
interface RenameSessionInput {
  readonly session: SessionReference
  readonly title: string
  readonly expectedRevision?: number
}
```

Title 去除首尾空白后必须非空。Rename 修改 Session 显示标题，不改变历史内容、Workspace membership 或 Agent 状态。

`expectedRevision` 只在 `revision-checked` agreement 中有效。Provider 可以把 rename 表示为自身历史中的事件，也可以只更新独立元数据；两种实现必须产生相同的 Catalog 可观察结果。`v1alpha1` 不要求 History 包含 rename event；Provider 如果记录该事件，必须按照 SessionEvent vocabulary 将它作为额外的持久事实公开。

### Delete

```ts
interface DeleteSessionInput {
  readonly session: SessionReference
  readonly expectedRevision?: number
}

interface DeleteSessionResult {
  readonly deleted: boolean
}
```

Delete 销毁 Session descriptor 与其持久历史。它不删除 Workspace、Workspace location、Content provider 中不再由该 Session 独占的对象或与 Session 关联的外部资源。

Provider 在删除前终止相应 History follow。活动 Agent 仍引用该 Session 时，Provider 拒绝删除，或先通过已授权的 AgentControl 明确关闭；不能让底层存储删除隐式终止未知 Agent。

未知或已经删除的 reference 返回 `deleted: false`，使请求可以安全重试。破坏性删除仍需独立 permission；幂等结果不构成授权放宽。

### Watch

Catalog watch 从调用时的目录 revision 开始，产生 session-created、descriptor-changed、session-deleted 和 catalog-invalidated event。Client 可以用 list 返回的 revision 衔接分页 snapshot 与后续变化。

```ts
interface WatchSessionCatalogInput {
  readonly afterRevision?: number
}

type SessionCatalogEvent =
  | { readonly type: 'session-created' | 'descriptor-changed'; readonly beforeRevision: number; readonly afterRevision: number; readonly session: SessionDescriptor }
  | { readonly type: 'session-deleted'; readonly beforeRevision: number; readonly afterRevision: number; readonly session: SessionReference }
  | { readonly type: 'catalog-invalidated'; readonly beforeRevision: number; readonly afterRevision: number }

type SessionCatalogWatchProgress =
  | { readonly type: 'ready'; readonly catalogRevision: number }
  | { readonly type: 'event'; readonly event: SessionCatalogEvent }
```

Watch 的第一帧必须（MUST）是 `ready`，其中 `catalogRevision` 是订阅建立时的当前 revision；后续帧才可以是 `event`。指定 `afterRevision` 时，Provider 在 ready 后先发送 `(afterRevision, catalogRevision]` 内保留的变化，再发送新的变化；无法从该 revision 连续重放时，调用必须以 catalog-invalidated 错误失败。省略它时，只发送 ready revision 之后的新变化。

每个 event 的 `beforeRevision` 必须等于上一帧确定的 revision，`afterRevision` 必须增大。出现 revision 空洞或 `catalog-invalidated` 后，Provider 必须终止 stream，client 重新调用 list。Catalog watch 不携带 Session 历史事件。

Watch 是长调用；Connection `result` 只在 stream 结束时 resolve，因此实现不得把 ready revision 放在最终 result 中。它必须通过首个 `ready` progress 帧交付。Ready 只建立 revision cut，不复制可能无界的完整 Catalog snapshot。

## `SessionHistory`

### Declaration

```ts
type SessionHistoryOperation =
  | 'read'
  | 'follow'
  | 'fork'

interface SessionHistoryRequirementSpec {
  readonly operations: readonly SessionHistoryOperation[]
  readonly optionalOperations?: readonly SessionHistoryOperation[]
  readonly sessionDomain?: string
}

interface SessionHistorySupportSpec {
  readonly sessionDomain: string
  readonly operations: readonly SessionHistoryOperation[]
  readonly limits?: SessionHistoryLimits
}

interface SessionHistoryLimits {
  readonly maxPageEvents?: number
  readonly maxEventBytes?: number
  readonly maxFollowBuffer?: number
  readonly maxForkEvents?: number
}
```

History agreement 记录 provider、clients、session domain、operations 和单页事件数、单事件大小、follow 缓冲等限制。

### Event envelope

```ts
interface SessionEventEnvelope<Data = unknown> {
  readonly session: SessionReference
  readonly cursor: SessionCursor
  readonly type: string
  readonly timestamp?: string
  readonly replay: 'required' | 'ignorable'
  readonly data: Data
}
```

Cursor 是 provider 分配、不透明且在当前 Session history incarnation 内稳定的事件位置。它不等同于数组下标、字节 offset、时间戳或 event type。

同一 Session 中 cursor 形成严格顺序。Provider 不得将一个 cursor 重新分配给不同事件。Session fork 可以保留 lineage cursor，但新 Session 拥有自己的 cursor space。

Envelope 的 `type` 对应 `SessionEvent` resource identity。`replay` 同时写入 envelope，使缺少 resource 的读取器仍能判断未知事件是否可跳过。

### Read

```ts
interface ReadSessionHistoryInput {
  readonly session: SessionReference
  readonly after?: SessionCursor
  readonly before?: SessionCursor
  readonly direction?: 'forward' | 'backward'
  readonly limit?: number
}

interface SessionHistoryPage {
  readonly session: SessionReference
  readonly events: readonly SessionEventEnvelope[]
  readonly first?: SessionCursor
  readonly last?: SessionCursor
  readonly hasMore: boolean
}
```

`after` 和 `before` 为开区间边界。省略边界时，forward 从历史开头读取，backward 从历史末尾读取。返回 events 始终按历史正序排列，使客户端不必因翻页方向反转 event 语义。

Provider 返回的 events 数量不得超过请求的 `limit` 或 agreement 的 `maxPageEvents`，取两者中较小者。

Cursor 不存在、属于其他 Session 或已因 provider 明确的 retention policy 失效时返回 cursor-invalid，不得静默从开头继续。

Read 是持久历史 snapshot，不包含尚未由 Session provider提交的 Agent stream delta。

### Follow

Follow 从指定 cursor 之后观察新提交的 event。省略 cursor 表示从订阅建立时的末尾开始，只接收之后的提交；需要完整历史的 client 先 read，再用最后 cursor 建立 follow。

```ts
interface FollowSessionHistoryInput {
  readonly session: SessionReference
  readonly after?: SessionCursor
}

type SessionHistoryFollowProgress =
  | { readonly type: 'ready'; readonly session: SessionReference; readonly boundary?: SessionCursor }
  | { readonly type: 'event'; readonly event: SessionEventEnvelope }
```

Follow 的第一帧必须（MUST）是 `ready`，其中 `boundary` 是订阅建立时已提交历史的末端 cursor；空历史可以省略 boundary。指定 `after` 时，Provider 在 ready 后依次发送 `(after, boundary]` 内尚未读取的 event，再发送 boundary 之后的新提交，因此 read 与订阅之间不会产生空洞。省略 `after` 时，Provider 从 ready boundary 之后的新提交开始发送。

后续每一帧必须是 `event`，且属于请求中的同一 Session。Connection `result` 只在 stream 结束时 resolve；Provider 不得用最终 result 充当 ready acknowledgment。

背压超过 agreement 限制、Session 删除、permission 撤销或 history incarnation 改变时，stream 明确关闭。Client 重新 read；Provider 不无限缓存。

### Fork

```ts
interface ForkSessionInput {
  readonly source: SessionReference
  readonly through: SessionCursor
  readonly requestId: string
}

interface ForkSessionResult {
  readonly session: SessionDescriptor
}
```

Fork 创建一份新的 Session，其语义状态等于 source 重放至 `through` event 后的状态。它不截断或修改 source。

Required event 无法解释或 cursor 不在 source 中时整体失败。Provider 可以用 copy-on-write、结构共享或物理复制实现；存储方式不改变结果。

Fork result 的 descriptor 记录 lineage。`requestId` 使用与 Catalog create 相同的幂等规则。Fork 不复制或创建 Workspace membership；client 只能通过独立的 `WorkspaceSessions.attach` 建立新归属。

History 协议不定义“按屏幕中的第几行 rewind”。UI 负责把选中的可重放位置对应到 SessionCursor，再调用 fork。

### No arbitrary append

`v1alpha1` 不向普通 History client 提供任意 append。能够读取 Session 或声明 SessionEvent resource，不表示能够伪造 Agent、tool、permission 或其他组件拥有的事件。

Session runtime 可以在本地向已授权组件提供更窄的 writer facade。Writer 必须绑定 event owner、Session incarnation、允许的 event type、replay 分类、validator、permission、payload limit、request id 幂等规则和 activation lifecycle；该 facade 不是 SessionHistory client 的隐含成员。

## `SessionEvent`

### Resource

Facet 可以声明一种持久事件类型：

```ts
{
  apiVersion: 'session.dsh/v1alpha1',
  kind: 'SessionEvent',
  metadata: { name: 'example/analysis-completed' },
  spec: {
    description: 'Persisted result of an analysis operation.',
    replay: 'ignorable',
    schemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    payloadSchema: { type: 'object' },
  },
}
```

```ts
interface SessionEventSpec {
  readonly description: string
  readonly replay: 'required' | 'ignorable'
  readonly schemaDialect?: string
  readonly payloadSchema?: Readonly<Record<string, unknown>>
}
```

`metadata.name` 是 event envelope 的 type。`payloadSchema` 是不可执行 schema 数据，不包含 validator 或 callback。新声明如果提供 schema，应该（SHOULD）用 `schemaDialect` 明确标识 dialect。为兼容既有 `v1alpha1` resource，缺少 dialect 的 schema 仍必须被接受，但 consumer 只能把它当作不透明说明，不能声称校验成功；未知 dialect 采用相同处理。

### Replay

- `required`：事件可能影响状态重建；读取器不理解该 type 时拒绝重放、fork 或恢复；
- `ignorable`：事件不影响状态重建；读取器可以保留 envelope 而跳过其语义。

Runtime 不能仅凭当前 vocabulary 把未知事件推断为 ignorable。Envelope 的 replay 标记必须与写入时有效的 resource 一致。

### Identity and ownership

Event type identity 由 `apiVersion`、`kind` 和 `metadata.name` 组成。同一 composition scope 中只有一个 owner。相同 spec 的重复声明仍构成所有权冲突。

Facet 未被选择时，其 resource 不进入当前 vocabulary。Facet 停用不删除既有历史；读取器仍根据 envelope 和可用 resource 判断能否重放。

## Content

普通文本可以出现在所属 event schema 中。图片、文件和其他二进制内容使用 `@dsh-std/content` 的 ContentReference；Session event 不保存发送端本地路径、临时上传 handle 或任意未验证 URL。

Session provider 在提交引用某项 content 的 required event 前，必须取得至少覆盖 Session retention 的 content lease，或把内容持久化到自身拥有的存储。删除 Session 后如何释放独占 content 由 Content 协议的 owner/lease 规则决定。

## Connection binding

Catalog 与 History 可以在进程内由 scoped SDK 使用，也可以在 `@dsh-std/connection` attachment 上交换类型化 request、response 和 event。

Connection agreement 绑定 provider、client、session domain 和 operations。Connection Host 不解析 Session event、不访问日志文件，也不根据任意 method string 调用产品 Session 对象。

Catalog watch 与 History follow 使用独立 attachment 和背压。一个 stream 堵塞不能阻止另一个协议的控制消息。

## Errors

协议定义以下稳定 error code；transport 可以为它们提供语言专用的 error class，但不得改写 code：

- `REFERENCE_MISMATCH`：provider、session domain 或 agreement 不匹配；
- `SESSION_NOT_FOUND`、`SESSION_UNAVAILABLE`、`SESSION_IN_USE`：Session 生命周期状态不允许操作；
- `OPERATION_NOT_NEGOTIATED`：operation 未协商；
- `PAGE_CURSOR_INVALID`、`EVENT_CURSOR_INVALID`、`LINEAGE_CURSOR_INVALID`：相应 cursor 无效；
- `CATALOG_INVALIDATED`、`DESCRIPTOR_INVALIDATED`、`HISTORY_INVALIDATED`：相应 snapshot 或 stream 已失效；
- `UNKNOWN_REQUIRED_EVENT`：未知 required event 阻止重放或 fork；
- `INVALID_REQUEST`、`REVISION_CONFLICT`：输入或并发前置条件不成立；
- `PERMISSION_NOT_GRANTED`：permission 或 disclosure policy 拒绝；
- `FLOW_CONTROL_EXCEEDED`：stream 超过协商的流控限制；
- `PROVIDER_UNAVAILABLE`、`COMMIT_FAILED`：provider 不可用或持久提交失败。

错误保留稳定 code 和结构化 detail。日志路径、数据库 key、未裁剪 event payload、credential 和产品 stack 不直接进入远端 detail。

## Security considerations

- SessionReference、cursor、event type 和 lineage 都不是授权凭据。
- Catalog 与 History 分别授权；能够列出 descriptor 不表示能够读取内容。
- List、get、read、follow 和 event payload 都按 client scope 与 peer policy 裁剪。
- Delete、rename、create 和 fork 需要相应 mutation permission。
- Cursor 绑定 provider、Session 和 history incarnation，不能跨 Session 猜测或复用。
- Unknown required event 不得被跳过后继续产生看似成功的 fork。
- Secret、approval token 和 credential 不进入普通 Session event；需要审计时记录不含秘密值的结果事件。
- ContentReference 在读取时再次授权，Session 对它的引用不扩大 content permission。
- Provider 限制 catalog page、history page、event 大小、follow 缓冲、并发 stream 和 fork 成本。

## Relationship to other proposals

- Core 声明并协商 SessionCatalog、SessionHistory 与 SessionEvent；
- Connection 承载远端 Session request、response 和 stream；
- Agent 可以创建、附着或写入 Session，但 AgentReference 与 SessionReference 不等价；
- WorkspaceSessions 拥有 Session 的分组归属与手动顺序；
- Content 提供持久事件引用的文本外内容；
- 已提交的 Session event 只能通过 SessionHistory read/follow 观察；实现不得再把同一 durable fact 镜像成另一套无 cursor 的通用 event stream；
- 领域运行时中尚未提交为 Session history 的 transient observation 不是 SessionHistory，并且不能声称可补读或可重放；
- Permission 决定目录、历史、mutation 和 event payload 的实际可见性。

## Rationale and alternatives

### 把 Session 当作 Agent

Session 可以在 Agent 停止后读取，也可以在没有执行能力的工具中导出或索引。分离 identity 避免只读客户端取得 AgentControl。

### 直接公开日志文件

文件布局没有 provider identity、snapshot、cursor、unknown event 和远端背压语义。SessionHistory 保留存储实现自由，同时提供一致读取结果。

### 把 Catalog 与 History 合为一个 capability

目录元数据和完整历史具有不同的数据量与权限。独立 kind 允许客户端只实现或只授权其中一项，同时共享 SessionReference。

### 为每一种 Session event 建立 RPC

持久事件是可重放记录，不一定对应可调用操作。SessionEvent resource 提供 vocabulary；运行时操作由拥有该行为的领域协议定义。

### 用 rewind 修改原 Session

截断会破坏已有 cursor 和并发 reader。Fork 保留 source，并用 lineage 明确产生新 Session。

### 在 History 中暴露任意 append

任意 writer 可以伪造其他组件拥有的状态变化。Writer 应由 Session runtime 按 event owner 与调用 scope 签发，而不是作为读取协议的通用成员。

## Drawbacks

Catalog、History 与 Event vocabulary 分开后，完整客户端需要组合多份协议。

Opaque cursor 需要 provider 保存稳定映射，客户端也不能脱离 provider 对日志位置进行本地计算。

Fork 要求 provider能够重放 required event。缺失事件实现时，即使原始字节仍存在也可能无法创建语义正确的新 Session。

## Unresolved questions

### Standard event vocabulary

Agent turn、user message、assistant content 和 tool activity 中哪些事件具有足够稳定的跨实现语义，可以进入标准 Session event vocabulary，尚未确定。产品事件可以继续使用有 owner 的 namespaced type。

### Retention

Provider 对历史、cursor 和关联 content 的 retention policy 如何声明，以及 client 如何在读取前判断某个 cursor 可能失效，需要与 Content lease 共同确定。

### Search

全文搜索、结构化 event 查询和索引更新具有独立资源与权限成本，不属于 list/read 的隐含行为。是否形成 SessionSearch protocol 取决于是否出现可互换的 provider 与 consumer。
