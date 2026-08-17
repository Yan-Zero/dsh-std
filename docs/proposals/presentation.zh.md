# `@dsh-std/presentation` 设计提案

- 文档类型：设计提案
- 状态：草案
- 日期：2026-08-17

## Summary

`@dsh-std/presentation` 定义 runtime 如何请求用户所在的 presentation endpoint 执行有限的用户侧操作和交互。终端、浏览器、编辑器、GUI 和自动化客户端可以分别实现这些协议，而调用方不依赖其 UI toolkit。

TypeScript 包按用途提供 subpath：

```ts
import { openExternalProtocol, notificationProtocol } from '@dsh-std/presentation/operations'
import { userInteractionProtocol } from '@dsh-std/presentation/interaction'
```

协议 identity 为：

| `apiVersion` | `kind` | 含义 |
| --- | --- | --- |
| `presentation.dsh/v1alpha1` | `OpenExternal` | 在用户环境打开 HTTP(S) URI |
| `presentation.dsh/v1alpha1` | `CopyText` | 把文本写入用户剪贴板 |
| `presentation.dsh/v1alpha1` | `Notification` | 显示短暂通知 |
| `presentation.dsh/v1alpha1` | `UserInteraction` | 问题、审批和秘密输入 |

这些 kind 可以分别声明、实现、协商和授权。Presentation 不定义页面、面板、scene、route、widget tree 或长期 UI contribution。

## Motivation

Plugin、Command、Agent 和 Model provider 经常需要在调用过程中与用户交互，例如打开认证页面、询问一个选项或请求高风险操作的批准。执行 runtime 可能位于远端、容器或无界面进程，不能直接调用本地浏览器、剪贴板或终端组件。

如果每个调用方认识 Web、TUI 和 GUI 的具体 API，同一插件就要实现多套 UI adapter；如果远端 runtime 发送任意 UI tree，又会把可执行界面和敏感输入引入不可信边界。

Presentation 使用少量结构化 operation。Endpoint 只实现自己能够正确呈现的 kind；调用方通过协商结果判断当前 invocation 是否具备所需交互。

## Roles

### Presentation consumer

Consumer 是发起用户侧操作的 participant，例如 Command runtime、Agent provider 或认证插件。它在自身 requirement 中声明所需 kind，并通过 invocation-scoped client 发起请求。

Consumer 不选择 Ink component、DOM node、窗口位置或键盘绑定，也不能用 presentation operation 绕过自身 permission。

### Presentation provider

Provider 是接近用户的 endpoint，例如 TUI、Web、GUI、编辑器或自动化 policy engine。它发布实际能够处理的 kind，并负责呈现、收集结果、取消和敏感数据隔离。

同一协商范围内可以存在多个 provider，但每次 invocation 必须由显式 policy 选择唯一 provider。注册顺序、最近连接或 UI 类型不能隐式决定审批权归属。

### Presentation authority

需要返回决定的交互具有 presentation authority。一个 request 在任一时刻只能由一个 provider authority 持有；观察者可以显示只读状态，但不能同时提交第二个结果。

Authority 变更必须在 request 尚未展示或经原 provider 明确释放后发生。Approval 或 SecretInput 已展示后，断线会取消 request，不静默转交给另一 provider。

## Common invocation model

### Request identity and scope

```ts
interface PresentationRequestContext {
  readonly requestId: string
  readonly invocationId: string
  readonly origin: string
  readonly deadline?: string
}
```

`requestId` 在 invocation 内唯一。`invocationId` 是 Host 为当前 Command、Agent turn 或其他调用签发的不透明引用。Consumer 不能传入任意 plugin 或 Session id 换取交互权限。

`origin` 是 agreement 中的 participant identity，用于显示经过 policy 允许的来源信息；它不是授权 principal。Endpoint 不根据远端提供的显示名称授予权限。

Deadline 到期、invocation 结束、consumer 停用、agreement 替换或 permission 撤销都会取消仍未完成的 request。

### Result

```ts
type PresentationResult<T> =
  | { readonly status: 'submitted'; readonly value: T }
  | { readonly status: 'cancelled' }
  | { readonly status: 'expired' }
  | { readonly status: 'unavailable'; readonly reason?: string }
```

Provider 对同一 request 只能提交一个 terminal result。Cancel 与 submit 并发时，以 Provider 已原子提交的第一个 terminal state 为准；另一方收到 already-settled。

Consumer 必须处理 cancelled、expired 和 unavailable，不能把缺失交互当作用户批准或空字符串。

### Direct invocation

协议实现按已协商的 kind 向 Consumer 提供类型化 client：

```ts
interface OpenExternalClient {
  openExternal(request: OpenExternalRequest): Promise<PresentationResult<OpenExternalReceipt>>
}

interface CopyTextClient {
  copyText(request: CopyTextRequest): Promise<PresentationResult<CopyTextReceipt>>
}

interface NotificationClient {
  notify(request: NotificationRequest): Promise<PresentationResult<NotificationReceipt>>
}

interface UserInteractionClient {
  interact(request: QuestionRequest): Promise<PresentationResult<QuestionAnswers>>
  interact(request: ApprovalRequest): Promise<PresentationResult<ApprovalValue>>
  interact(request: SecretInputRequest): Promise<PresentationResult<SecretInputValue>>
}
```

每个 Client 只对应一项 agreement。`UserInteractionClient` 只接受该 agreement 已协商且 invocation scope 已授权的 operation。它们都不提供任意 `kind`/payload dispatcher。

在进程内，SDK 可以直接调用 provider implementation；在 Connection 上，双方使用对应 protocol attachment。两种方式保持相同的 request lifetime 和 result 语义。

## `OpenExternal`

```ts
interface OpenExternalRequest extends PresentationRequestContext {
  readonly uri: string
}

interface OpenExternalReceipt {
  readonly accepted: true
}
```

URI 必须是绝对 HTTP 或 HTTPS URI。其他 scheme 需要独立 protocol kind，不能借助 URL 编码绕过。

`accepted` 表示 Provider 已把请求交给用户环境，不表示页面成功加载、用户查看或认证完成。认证结果由发起流程自己的协议确认。

Provider 可以因 scheme policy、无图形环境或用户设置返回 unavailable。它不能把远端 URI交给 shell 字符串执行。

## `CopyText`

```ts
interface CopyTextRequest extends PresentationRequestContext {
  readonly text: string
  readonly sensitivity?: 'public' | 'private'
}

interface CopyTextReceipt {
  readonly accepted: true
}
```

Text 必须非空并满足 agreement 的大小限制。`private` 提醒 Provider 采用不写日志、不显示全文的处理，但不是额外 permission grant。

`v1alpha1` 不允许通过 CopyText 传递 SecretInput 结果或 credential。秘密值使用 invocation-scoped secret result，并由 consumer 立即处理。

Receipt 不表示剪贴板内容在调用返回后仍然存在。

## `Notification`

```ts
interface NotificationRequest extends PresentationRequestContext {
  readonly text: string
  readonly level?: 'info' | 'warning' | 'error'
  readonly deduplicationKey?: string
}

interface NotificationReceipt {
  readonly accepted: true
}
```

Notification 是不要求用户响应的短暂消息。它不是持久 event、审计记录或 error transport。调用失败仍通过所属协议返回结构化 error，不能只显示通知后报告成功。

Provider 可以在 invocation 内按 deduplication key 合并尚未显示的重复通知。它不能跨 origin 或 invocation 合并。

## `UserInteraction`

### Declaration

```ts
type UserInteractionOperation = 'question' | 'approval' | 'secret-input'

interface UserInteractionRequirementSpec {
  readonly operations: readonly UserInteractionOperation[]
  readonly optionalOperations?: readonly UserInteractionOperation[]
}

interface UserInteractionSupportSpec {
  readonly operations: readonly UserInteractionOperation[]
  readonly limits?: UserInteractionLimits
}
```

Agreement 记录 provider、consumers、operations、并发 request 数、字段数、选项数和文本大小限制。支持 question 不表示支持 approval 或 secret-input。

### Question

```ts
interface QuestionRequest extends PresentationRequestContext {
  readonly kind: 'question'
  readonly title?: string
  readonly description?: string
  readonly fields: readonly QuestionField[]
}

type QuestionField =
  | {
      readonly id: string
      readonly kind: 'text'
      readonly label: string
      readonly description?: string
      readonly required?: boolean
      readonly multiline?: boolean
      readonly minLength?: number
      readonly maxLength?: number
    }
  | {
      readonly id: string
      readonly kind: 'select'
      readonly label: string
      readonly description?: string
      readonly required?: boolean
      readonly multiple?: boolean
      readonly options: readonly QuestionOption[]
    }
  | {
      readonly id: string
      readonly kind: 'confirm'
      readonly label: string
      readonly description?: string
      readonly required?: boolean
    }

interface QuestionOption {
  readonly id: string
  readonly label: string
  readonly description?: string
}

interface QuestionAnswers {
  readonly answers: Readonly<Record<string, string | boolean | readonly string[]>>
}
```

Field id 在 request 内唯一。Option id 在 field 内唯一。Provider 返回按 field id 建立的结构化 answer；select 返回 option id，不返回显示 label。

Text 对应 string，confirm 对应 boolean，single select 对应一个 option id，multiple select 对应 option id array。未回答的 optional field 不出现在 record 中；Provider 不用空字符串或 false 伪造缺失回答。

Question 不接受可执行 validator、HTML、Markdown script 或自定义 component。Consumer 在提交前负责协议 schema 能表达的约束；业务校验失败时可以发起新的 request，但不能在同一个 settled request 上修改字段。

Text question 不是 SecretInput。Provider 必须明确区分二者，不能用普通 text field 收集密码、token 或私钥。

### Approval

```ts
interface ApprovalRequest extends PresentationRequestContext {
  readonly kind: 'approval'
  readonly action: string
  readonly summary: string
  readonly details?: readonly ApprovalDetail[]
  readonly risk?: 'low' | 'medium' | 'high'
}

interface ApprovalDetail {
  readonly label: string
  readonly value: string
  readonly sensitivity?: 'public' | 'private'
}

interface ApprovalValue {
  readonly decision: 'approved' | 'denied'
}
```

Approval 只返回本次 invocation 的 approve 或 deny。诸如“以后都允许”“修改 sandbox policy”或“保存为全局规则”属于 Permission/Policy 协议，不能通过 presentation response 暗中扩大授权 scope。

Provider 必须清楚显示 action、summary、origin 和经 policy 允许的 details。Consumer 不能把 shell escape、ANSI control sequence 或 HTML 注入解释为可信 UI markup。

Approval agreement 不等于 operation 已获批准。Provider 也不能替代执行端最终的 permission 检查；执行端只接受与 request、invocation 和当前 policy 匹配的结果。

### Secret input

```ts
interface SecretInputRequest extends PresentationRequestContext {
  readonly kind: 'secret-input'
  readonly label: string
  readonly description?: string
  readonly minLength?: number
  readonly maxLength?: number
}

interface SecretInputValue {
  readonly secret: string
}
```

SecretInput 不提供默认值、回显文本、history 或普通 clipboard fallback。Provider 在提交后清除可控的临时 buffer；consumer 只在 invocation scope 内取得结果。

Secret 值不得进入 Session event、diagnostic、notification、error detail、request retry cache 或普通 telemetry。需要持久 credential 时，consumer 把值交给已经授权的 Credential Store；Presentation 不保存它。

连接丢失、authority 改变或 deadline 到期时，SecretInput 返回 cancelled/expired，已经输入但未提交的内容不得重放到新 endpoint。

### Request union

```ts
type UserInteractionRequest = QuestionRequest | ApprovalRequest | SecretInputRequest
```

类型化 client 根据 request kind 返回对应 value。实现不能仅返回 untagged object 后让 consumer 猜测结果类型。

## Connection binding

Presentation 通常是双向连接中的反向协议：Agent、Command 或认证 provider 位于一端，用户 UI 位于另一端。Connection agreement 必须把每个 Consumer requirement 绑定到唯一 Presentation provider。

Connection Host 只承载已经协商的 presentation message，并维护 request cancellation。它不渲染 UI、不读取 SecretInput，也不根据任意 operation string 查找 UI handler。

Provider 与 Connection Host 不在同一进程时，Provider 通过标准 participant publication 公开实现。Publication lease 结束会取消尚未 settled 的 request。

## Errors

协议错误至少区分：

- operation 未协商或 provider unavailable；
- request、invocation 或 origin scope 无效；
- request id 重复但 payload 不同；
- request 已 settled、cancelled 或 expired；
- presentation authority conflict；
- field、option、URI、文本或 detail 无效；
- answer 与 request schema 不匹配；
- permission 或 policy 拒绝；
- flow control 或并发限制超出；
- provider disconnected 或 implementation failed。

错误 detail 不包含 SecretInput、私有 approval detail、clipboard text 或未裁剪产品 stack。

## Security considerations

- Presentation support 表示能够呈现，不表示 consumer 已获执行权限。
- Invocation scope 由 Host 签发，consumer 不能用 plugin id、Session id 或远端字符串自行构造。
- 每项 interaction 只有一个 authority 和一个 terminal result。
- Approval 只对绑定 invocation 生效，不产生持久 policy grant。
- SecretInput 从普通 question、clipboard、Session、diagnostic 和 telemetry 路径隔离。
- URI、text、label 和 detail 都按大小与 control-character policy 校验。
- Provider 不执行来自 consumer 的 HTML、JavaScript、ANSI control sequence、shell string 或本地模块。
- UI 可以隐藏未支持的 kind；不能把 unavailable 自动解释为默认同意。
- Consumer 与 Provider 都限制并发、队列、deadline 和重复 request。

## Relationship to other proposals

- Core 声明并协商每种 Presentation kind；
- Connection 承载双向 request/result 和 cancellation；
- Command 可以在 invocation 中使用 Presentation client，但不拥有 UI；
- Agent 可以请求 question 或 approval，但 Agent event 只记录不含秘密的结果状态；
- ContentReference 可以用于将非秘密附件展示给用户，Presentation 不直接访问文件路径；
- Permission 决定 Consumer 是否可以发起交互及 Approval result 的有效 scope；
- UI contribution 处理长期页面、面板和 scene，不替代 invocation-scoped Presentation。

## Rationale and alternatives

### 一个任意 UiOperation

任意 payload 无法声明最小能力、校验敏感数据或形成跨实现结果。固定 kind 与 operation 让 Provider 只实现自己能安全呈现的部分。

### 远端发送 UI tree

UI tree 会绑定 toolkit，并可能携带可执行代码和不可信 markup。Presentation 只传结构化语义，layout 与交互细节由 Provider 所有。

### 用普通 Question 收集秘密

普通 answer 可能进入 history、日志、回显和自动填充。SecretInput 需要单独的生命周期、存储和错误约束。

### Approval 返回永久授权

Presentation endpoint 不拥有执行端 policy。永久 grant 必须由 Permission 协议定义 scope、principal、撤销和持久化规则。

### 把交互结果写入 Session

Presentation request 属于 invocation。所属领域可以记录不含秘密的业务结果，但 Presentation 本身不强制创建持久 Session event。

## Drawbacks

结构化 operation 无法表达任意复杂表单和产品专属 UI。需要复杂流程的插件可以组合多次 invocation，或提供经 UI contribution 协商的长期 surface。

Presentation provider 必须维护 pending request、authority、deadline 和 cancellation，而不只是暴露一个 callback。

Question field 是多个 UI 的公共子集；富文本编辑、文件树、代码 diff 和自定义验证不属于 `v1alpha1`。

## Unresolved questions

### File and directory selection

选择文件或目录涉及 provider execution world、ContentReference、Workspace locator 与路径 disclosure，不能只增加一个 text field。是否形成 Presentation subpath，取决于能否给出不泄露本地路径的稳定结果。

### Automated providers

无界面 policy engine 可以实现 Approval 或 Question 的受限子集。它必须与人类 UI 使用相同的 origin、scope 和结果语义；是否需要在 support 中声明 automated 属性，尚未确定。
