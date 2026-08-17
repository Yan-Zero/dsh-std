# `@dsh-std/agent` 设计提案

- 文档类型：设计提案
- 状态：草案
- 日期：2026-08-17

## Summary

`@dsh-std/agent` 定义活动 Agent 的控制与运行配置协议。控制协议用于发现、创建、附着、观察和驱动 Agent；配置协议用于描述、读取和修改某个 Agent 接受的配置。两者共享 Agent identity、attachment、revision、错误与生命周期语义，但可以分别声明、实现和协商。

TypeScript 包使用 subpath 区分协议表面：

```ts
import { type AgentReference } from '@dsh-std/agent'
import { agentControlProtocol } from '@dsh-std/agent/control'
import { agentConfigurationProtocol } from '@dsh-std/agent/configuration'
```

Subpath 不是独立 npm 包，也不产生新的版本轴。协议 identity 为：

| `apiVersion` | `kind` | 含义 |
| --- | --- | --- |
| `agent.dsh/v1alpha1` | `AgentControl` | Agent 生命周期、附着、状态、输入与执行控制 |
| `agent.dsh/v1alpha1` | `AgentConfiguration` | Agent 配置描述、读取与条件更新 |

本协议处理活动 Agent，不定义持久会话格式、模型 provider、workspace 文件操作、工具执行或用户界面。输入和输出使用 `@dsh-std/content` 的共享 ContentBlock。

## Motivation

TUI、Web、GUI 和自动化客户端需要以相同方式控制本地或远端 Agent。如果客户端直接调用某个产品的 Agent class、事件总线和设置 store，远端连接就只能复制该产品的内部对象；其他实现也无法提供相同能力。

Agent 控制与配置关系紧密，但并非同一权限：只读观察者不一定能提交输入，控制者也不一定能修改 sandbox 或 approval policy。把它们放入同一协议包可以共享对象和版本；使用不同 kind 则允许实现、协商和授权保持独立。

Agent 不是持久 Session 的别名。Agent 是接受输入并产生执行状态的活动实体；Session 是可以在 Agent 停止后继续存在的记录。一个 Agent 可以关联 Session，也可以是无持久记录的临时实体。

## Roles

### Agent provider

Agent provider 拥有 Agent 实例及其执行生命周期。它发布 `AgentControl` support，并为允许配置的 Agent 发布 `AgentConfiguration` support。

同一 endpoint 可以存在多个 provider。每份 agreement 必须明确绑定 provider；注册顺序不能决定客户端连接到哪个 provider。无法根据 requirement 和显式 policy 得到唯一 provider 时，协商失败并报告歧义。

### Agent client

Agent client 通过协议 client 发现和附着 Agent。客户端可以只有观察权限，也可以取得排他的控制 lease。TUI、Web 和 GUI 都是可能的 client；协议不赋予其中任何界面类型特殊地位。

### Observer and controller

同一 Agent 可以有多个 observer。会改变 Agent 状态的操作必须携带当前有效的 controller lease。

`v1alpha1` 对每个 Agent 至多允许一个 controller lease。Provider 可以拒绝新的控制请求，也可以要求当前 controller 明确释放或转交；不能因另一个客户端刚刚附着就静默撤销现有 controller。

## Shared model

### AgentReference

```ts
interface AgentReference {
  readonly provider: string
  readonly id: string
}
```

`provider` 是当前 agreement 中的 provider participant identity。`id` 由 provider 分配，在该 provider incarnation 内唯一且不得复用。

Reference 只用于寻址，不是 bearer credential。Provider 在每次操作时仍须检查调用 attachment、controller lease 和当前 permission。远端发送的 provider 或 Agent id 不能作为本地授权 principal。

### Agent descriptor

```ts
interface AgentDescriptor {
  readonly agent: AgentReference
  readonly title?: string
  readonly state: AgentLifecycleState
  readonly session?: SessionReference
  readonly workspace?: WorkspaceReference
  readonly createdAt?: string
}

type AgentLifecycleState =
  | 'starting'
  | 'idle'
  | 'running'
  | 'waiting'
  | 'stopping'
  | 'closed'
  | 'failed'
```

Session 与 workspace reference 是相应领域协议拥有的不透明引用。Agent 协议不解析其内部字段，也不允许用未经相应 provider 验证的路径或字符串替代 reference。

`waiting` 表示 Agent 已接受当前 turn，但正在等待外部输入、approval 或其他已声明依赖。具体交互由相应协议完成；Agent event 只报告执行状态。

### Revision

Agent 的可观察状态具有单调递增的 `revision`。Snapshot 表示某一 revision 的完整状态；event 表示从前一 revision 到后一 revision 的变化。

Revision 只在 Agent 生命周期内有意义。它不代替 Session event cursor，也不承诺在 Agent provider 重启后继续递增。

### Turn and controller references

```ts
interface AgentTurnReference {
  readonly agent: AgentReference
  readonly id: string
}

interface AgentControllerState {
  readonly epoch: number
  readonly holder: string
  readonly expiresAt?: string
}
```

Turn id 在 Agent 生命周期内唯一且不复用。Controller state 中的 holder 是当前 agreement 中的 client participant identity；它用于协调控制权，不是授权 principal。

## `AgentControl`

### Declaration

Requirement 和 support 使用固定 operation 名称声明所需功能：

```ts
type AgentControlOperation =
  | 'list'
  | 'create'
  | 'attach'
  | 'inspect'
  | 'request-control'
  | 'release-control'
  | 'transfer-control'
  | 'submit'
  | 'steer'
  | 'cancel'
  | 'close'

interface AgentControlRequirementSpec {
  readonly operations: readonly AgentControlOperation[]
  readonly optionalOperations?: readonly AgentControlOperation[]
}

interface AgentControlSupportSpec {
  readonly agentDomain: string
  readonly operations: readonly AgentControlOperation[]
  readonly limits?: AgentControlLimits
}
```

`operations` 中的每项都必须由 agreement 满足；`optionalOperations` 缺失时不阻止协商。Support 只能声明当前 provider 实际能够处理的操作。

`agentDomain` 标识 provider 中共享同一 Agent reference space 的协议实现。它只在当前 endpoint view 中用于关联协议，不是全局名称或授权 principal。

Agreement 记录选中的 provider、clients、agent domain、可用 operation 与协商 limits。注册 protocol definition 或能够解析 Agent message 不构成 live support。

### Catalog and creation

`list` 返回当前调用 scope 可见且可附着的 Agent descriptor。它不是所有进程或所有用户 Agent 的全局枚举。

`create` 创建一个活动 Agent：

```ts
interface CreateAgentInput {
  readonly session?: SessionReference
  readonly workspace?: WorkspaceReference
  readonly configuration?: Readonly<Record<string, unknown>>
  readonly requestId: string
}
```

`requestId` 在当前 client scope 内用于幂等重试。相同 request id 与相同输入必须返回同一创建结果；相同 id 与不同输入返回 conflict。

如果请求包含初始 configuration，本次 scope 必须同时具有匹配 agent domain 的 `AgentConfiguration` agreement。Provider 按照该协议的 descriptor、校验和 policy 原子验证。配置不受支持或未授权时，不能先用默认值创建 Agent 后再报告配置失败。

### Attachment

Client 在观察或控制 Agent 前创建 attachment：

```ts
interface AttachAgentInput {
  readonly agent: AgentReference
  readonly access: 'observe' | 'control'
}

interface AgentAttachment {
  readonly id: string
  readonly agent: AgentReference
  readonly access: 'observe' | 'control'
  readonly signal: AbortSignal
  readonly controller?: ControllerLease
}
```

Attachment 由本端协议实现签发并绑定 connection、agreement、client participant 和 Agent。字符串形式的 attachment id 不能脱离该绑定自行构造有效 handle。

关闭 connection、替换 agreement、撤销 permission、停止 participant 或关闭 Agent 都会终止 attachment。Attachment 终止后，所有新操作返回稳定的失效错误。

### Controller lease

```ts
interface ControllerLease {
  readonly epoch: number
  readonly holder: string
  readonly expiresAt?: string
}
```

`request-control` 请求取得控制权。没有现任 controller 时，Provider 可以立即签发 lease；已有 controller 时，Provider 返回明确的 pending、denied 或 conflict 结果。协议不允许以 attachment 注册顺序、最近输入时间或 UI 类型进行隐式抢占。

`release-control` 由当前 holder 主动释放。`transfer-control` 指定已经附着到同一 Agent 的目标 client，并产生递增的 lease epoch。旧 epoch 的 mutation 即使延迟到达，也必须被拒绝。

Permission policy 可以允许管理者撤销 lease，但这种撤销必须产生 control-change event，不能伪装成普通断线。

### Snapshot and events

```ts
interface AgentSnapshot {
  readonly agent: AgentDescriptor
  readonly revision: number
  readonly activeTurn?: AgentTurn
  readonly controller?: AgentControllerState
  readonly configurationRevision?: number
}
```

`inspect` 返回完整 snapshot。Attachment 可以订阅该 Agent 的 live event stream；每个 event 包含 Agent reference、前后 revision 和一种协议定义的 payload。

```ts
interface AgentTurn {
  readonly turn: AgentTurnReference
  readonly state: 'accepted' | 'running' | 'waiting' | 'completed' | 'cancelled' | 'failed'
  readonly startedAt?: string
}

interface AgentEventEnvelope {
  readonly agent: AgentReference
  readonly fromRevision: number
  readonly revision: number
  readonly event: AgentEvent
}

type AgentEvent =
  | { readonly type: 'lifecycle-changed'; readonly state: AgentLifecycleState }
  | { readonly type: 'turn-accepted'; readonly turn: AgentTurn }
  | { readonly type: 'turn-state-changed'; readonly turn: AgentTurn }
  | { readonly type: 'turn-output'; readonly turn: AgentTurnReference; readonly output: AgentOutput }
  | { readonly type: 'control-changed'; readonly controller?: AgentControllerState }
  | { readonly type: 'configuration-changed'; readonly configurationRevision: number; readonly keys?: readonly string[] }
  | { readonly type: 'attachment-closed'; readonly attachmentId: string; readonly reason?: string }
  | { readonly type: 'state-invalidated' }
```

Agent event 只携带跨实现可解释的 live state。Goal、Todo、Skill、Subagent、tool detail、spinner 和产品 telemetry 不属于基础 Agent event；拥有这些对象的协议可以独立发布 support。

事件序列出现空洞或 client 收到 `state invalidated` 后，必须重新调用 `inspect`。Agent event stream 不是持久 transcript；离线历史与重放由 Session 协议提供。

### Turns and input

```ts
interface AgentInput {
  readonly content: readonly ContentBlock[]
}

interface SubmitAgentInput {
  readonly attachment: AgentAttachment
  readonly controller: ControllerLease
  readonly input: AgentInput
  readonly requestId: string
}

interface SteerAgentInput {
  readonly attachment: AgentAttachment
  readonly controller: ControllerLease
  readonly turn: AgentTurnReference
  readonly input: AgentInput
  readonly requestId: string
}

interface CancelAgentInput {
  readonly attachment: AgentAttachment
  readonly controller: ControllerLease
  readonly turn: AgentTurnReference
}

type AgentOutput =
  | { readonly type: 'text-delta'; readonly streamId: string; readonly text: string }
  | { readonly type: 'content'; readonly blocks: readonly ContentBlock[] }
```

`submit` 在 idle Agent 上创建一个 turn。成功结果表示 provider 已接纳输入，并返回 `AgentTurnReference`；不表示 turn 已执行完成。相同 request id 与相同输入返回同一接纳结果，相同 id 与不同输入返回 conflict。

`steer` 为当前 active turn 提交补充指示。没有 active turn、目标 turn 已结束或 provider 不支持 steering 时，返回相应错误；实现不能把失败的 steer 静默转换成新 turn。

`cancel` 请求停止指定 active turn。Cancel 是幂等操作。Provider 接受 cancel 后仍需发送最终 turn event，说明 turn 已 cancelled、completed 或 failed；调用返回不等于执行已经停止。

Text delta 只追加到同一 `streamId`，不表示持久 Session event 已提交。完整内容和非文本内容使用 ContentBlock；文件、图片和其他大对象使用经过授权的 ContentReference，不在 Agent message 中携带本地路径或任意 URL。

AgentControl 不定义“从 pending inbox 撤回消息”“中断后自动排队多个输入”或“无日志侧问”等组合操作。Client 可以用 submit、steer、cancel 与所属 Session 协议实现自己的工作流；具有独立互操作需求的行为另行声明协议 operation。

### Closing

`close` 终止活动 Agent 及其 attachment。关闭 Agent 不隐含删除其 Session、workspace 或附件内容。删除持久资源必须使用拥有该资源的领域协议。

Client 关闭自己的 attachment 也不等于关闭 Agent。Provider 不得仅因最后一个 observer 离开就推断用户要求终止 Agent，除非该 Agent 在创建时明确采用了 attachment-scoped lifetime。

## `AgentConfiguration`

### Configuration domain

Configuration support 与 AgentControl support 必须声明同一 `agentDomain`。只有 domain 相同且 provider 明确接受该组合时，Configuration client 才能对 Control 返回的 AgentReference 操作。

```ts
interface AgentConfigurationSupportSpec {
  readonly agentDomain: string
  readonly operations: readonly ('describe' | 'read' | 'update')[]
}
```

`agentDomain` 是 endpoint view 中的不透明关联值，不是全局 provider 名称或权限 principal。

### Descriptor

Provider 通过 `describe` 返回配置 descriptor：

```ts
interface AgentConfigurationDescriptor {
  readonly schemaId: string
  readonly schemaRevision: number
  readonly fields: readonly AgentConfigurationField[]
}

interface AgentConfigurationField {
  readonly key: string
  readonly description: string
  readonly schema: Readonly<Record<string, unknown>>
  readonly mutable: 'before-create' | 'idle' | 'always' | 'never'
  readonly sensitivity?: 'public' | 'private' | 'secret'
}
```

Key 在 descriptor 内唯一。无 scope 的 key 由 Agent 协议保留；实现专属 key 必须使用实现拥有的 namespace。客户端不能因为能够显示 schema 就假定自己有权读取或修改该字段。

Descriptor 描述当前 provider 接受的数据形状。Schema dialect 必须由 `schemaId` 明确标识；未知 dialect 的客户端可以把字段作为不可编辑项显示，但不能声称已经完成本地校验。

### Snapshot

```ts
interface AgentConfigurationSnapshot {
  readonly agent: AgentReference
  readonly revision: number
  readonly schemaRevision: number
  readonly values: Readonly<Record<string, unknown>>
  readonly redacted: readonly string[]
}
```

`read` 只返回调用者可见的字段。Secret 不返回原值；存在但不可读的字段列入 `redacted`。字段未出现不能被解释为未设置，除非 descriptor 明确声明该字段公开且 snapshot 完整。

Snapshot 表示 Agent 当前接受的显式配置，不要求暴露由模型、workspace、policy 或环境推导出的所有内部默认值。需要向客户端展示 effective value 的字段必须在 descriptor 中定义其语义。

### Conditional update

```ts
interface UpdateAgentConfigurationInput {
  readonly agent: AgentReference
  readonly attachment: AgentAttachment
  readonly controller: ControllerLease
  readonly expectedRevision: number
  readonly changes: Readonly<Record<string, unknown>>
  readonly unset?: readonly string[]
}
```

Update 使用 compare-and-swap：`expectedRevision` 与当前 revision 不同则整体返回 conflict。Provider 对所有 change 执行 schema、lifecycle、permission 和 policy 校验后原子提交；不能只应用其中一部分。

字段的 `mutable` 是协议层上限，不是授权。即使字段标记为 `always`，Provider 仍可以因当前 policy 拒绝修改。配置修改不能绕过 model 可用性、sandbox、approval、workspace trust 或其他领域约束。

更新成功后，Provider 返回新的完整可见 snapshot，并通过 AgentControl stream 发布 configuration-changed event。无法向某个 observer公开字段内容时，事件只携带 revision 和可见 key 集合。

### Standard and implementation-defined keys

协议可以为具有跨实现语义的配置项保留标准 key。标准 key 的值、默认值、可变阶段和失败语义必须由 Agent 协议版本定义；只因多个产品使用相同字符串，不足以把它视为标准 key。

模型、工具、workspace 等对象使用所属协议的 reference。Configuration 不复制这些领域的目录，也不把产品内部 preset、class name 或 registry key 当作可移植标识。

实现专属字段在协商与 descriptor 中保持可见，但客户端不理解其 schema 或 namespace 时不得修改。未知字段不能被原样回传，以免覆盖 provider 在读取后产生的新值。

## Connection binding

Agent 协议可以在进程内由 scoped SDK 使用，也可以在 `@dsh-std/connection` attachment 上运行。传输方式不改变 AgentReference、controller lease、revision 和错误语义。

Connection agreement 为每个 Agent kind 绑定明确的 provider 与 clients。Agent provider 处理请求并产生 event；Connection Host 只承载已经协商的 message，不根据任意 method 字符串查找产品 Agent 对象。

AgentControl 与 AgentConfiguration 可以分别协商。Control agreement 没有 Configuration 时，客户端仍可使用 provider 默认配置；Configuration agreement 没有 Control 时，客户端只能执行其 permission 与 provider policy 允许的描述或读取操作，不能凭配置 capability 构造 AgentReference。

## Errors

协议错误至少区分：

- Agent、turn、attachment 或 configuration revision 不存在；
- Agent 已关闭或 provider incarnation 已失效；
- operation 未协商；
- attachment 不属于该 Agent、client 或 agreement；
- controller lease 缺失、过期或 epoch 已被替换；
- Agent lifecycle 不接受当前操作；
- control request pending、denied 或 conflicting；
- input、content reference 或 configuration 无效；
- configuration schema revision 已变化；
- configuration compare-and-swap conflict；
- permission 或 policy 拒绝；
- event state invalidated；
- provider unavailable 或执行失败。

错误必须保留稳定 code 和结构化 detail。产品异常、stack、绝对路径、credential 和未裁剪的内部配置不能直接作为远端 detail。

## Security considerations

- AgentReference、attachment id、controller holder 和 client participant identity 都不是可互换的授权凭据。
- 所有 mutation 同时检查 agreement、attachment、controller lease、Agent lifecycle、permission 和 provider policy。
- Control transfer 不得因新 client 连接而隐式发生。
- `list`、`inspect`、configuration descriptor 与 snapshot 均按调用 scope 裁剪。
- Secret configuration 不通过 snapshot、event、diagnostic 或 conflict response 回显。
- Content reference 在 provider 读取时再次授权，并限制大小、类型和生命周期。
- Provider 对 Agent 数、并发 turn、输入大小、事件缓冲、control request 和配置更新设置限制。
- Agent agreement 表示协议兼容，不表示 client 有权访问 endpoint 上的所有 Session、workspace、model 或 tool。

## Relationship to other proposals

- Core 声明并协商 `AgentControl` 与 `AgentConfiguration`；
- Connection 为远端 Agent message 和 event 提供 attachment；
- Session 拥有持久事件、历史、恢复与删除；
- Content 提供 Agent input/output 使用的共享 block 和二进制 reference；
- Model 拥有 provider 和 model 目录，Agent configuration 只保存经过验证的选择 reference；
- Tool 拥有工具发现与实现，AgentControl 不提供任意 tool invocation 后门；
- Command 表示命令目录和执行，不替代 Agent turn input；
- Presentation 处理 open、notification、question、approval 等用户侧操作；
- Permission 决定 Agent 可见性、control lease 和配置字段的实际授权。

## Rationale and alternatives

### 每项 Agent 操作一个包

Control、configuration、events 和 catalog 共享 Agent identity、lifecycle 和 revision。分别发布会产生重复类型和无法原子升级的兼容关系。一个协议包配合 subpath 可以保持代码边界，同时共享版本域。

### 一个无结构的 Agent RPC

任意 method 名称只能把产品内部 API 搬到 wire 上，无法协商操作、限制 mutation、校验配置或形成跨实现错误语义。固定 kind 与 message schema 使实现可以独立互操作。

### 把 Agent 与 Session 合并

Session 可以在没有活动 Agent 时读取，Agent 也可以不持久化。将二者合并会迫使只读历史客户端取得执行能力，并使关闭 Agent 与删除记录难以区分。

### 把全部配置定义为固定字段

模型、sandbox、approval 和实现扩展不会以相同速度演化。Descriptor 与 namespaced key 允许客户端发现当前 provider 接受的字段；只有已经具有跨实现语义的字段才进入标准 key 集合。

### 允许多个 controller 同时修改 Agent

并发 submit、steer、cancel 和 configuration update 会产生依赖到达顺序的结果。排他的 controller lease 与递增 epoch 给出确定的 mutation authority，同时保留多个 observer。

## Drawbacks

Agent provider 必须维护 attachment、controller lease、revision 和 event snapshot，而不只是暴露已有对象的方法。

Schema 驱动的 configuration 可以表达实现专属字段，但客户端不理解字段语义时只能提供有限界面。跨实现配置仍依赖少量经过规范化的标准 key。

Agent live events 与 Session history 分离后，完整客户端需要同时实现两份协议，并处理 live revision 与持久 cursor 的不同生命周期。

## Unresolved questions

### Control handoff

Controller 不响应时，是否存在带用户确认的 takeover、由谁有权发起，以及等待期间 mutation 如何表现，需要形成 transport-neutral 的规则。

### Standard configuration keys

首批跨实现配置 key 及其值语义尚未确定。Model selection、reasoning effort、approval 与 sandbox 只有在对应领域 reference 和 policy 边界清楚后才能成为标准字段。
