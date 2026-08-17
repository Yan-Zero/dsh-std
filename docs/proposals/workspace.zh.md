# `@dsh-std/workspace` 设计提案

- 文档类型：设计提案
- 状态：草案
- 日期：2026-08-17

## Summary

`@dsh-std/workspace` 定义 Workspace 注册记录及其 Session 归属。Workspace 是执行环境中某个工作位置的稳定逻辑引用；它具有独立于路径的 identity、显示信息、可用状态和持久顺序。

TypeScript 包使用 subpath 区分目录与 Session 索引：

```ts
import { type WorkspaceReference } from '@dsh-std/workspace'
import { workspaceCatalogProtocol } from '@dsh-std/workspace/catalog'
import { workspaceSessionsProtocol } from '@dsh-std/workspace/sessions'
```

协议 identity 为：

| `apiVersion` | `kind` | 含义 |
| --- | --- | --- |
| `workspace.dsh/v1alpha1` | `WorkspaceCatalog` | Workspace 查询、解析、注册、显示属性、顺序与状态 |
| `workspace.dsh/v1alpha1` | `WorkspaceSessions` | Workspace 与 Session 的归属及手动顺序 |

两个 kind 属于同一 npm 包和版本域，可以分别声明、实现、协商与授权。

Workspace 协议不读取或修改目录内容，不执行 shell，不创建或删除目录，也不定义文件选择界面。文件系统、进程执行和用户侧目录选择使用各自的协议，并以 WorkspaceReference 作为调用 scope。

## Motivation

Agent、Session 和 UI 都需要引用“当前工作区”，但原生路径不足以承担这项身份：

- 路径可能包含 `..`、symlink、大小写差异或平台专属格式；
- 相同路径在不同 endpoint 或 execution world 中没有相同含义；
- 目录暂时缺失时，用户仍可能希望保留注册记录和显示标题；
- 删除 UI 中的 Workspace 不应删除用户文件或会话记录；
- Workspace 与 Session 的手动分组、排序不应依赖最近活动时间；
- 远端客户端不应自行拼接服务端路径并把结果当作已经授权的文件句柄。

WorkspaceCatalog 为这些行为提供稳定协议。WorkspaceSessions 单独表达 Session 归属，使只需要选择执行位置的客户端不必取得 Session 管理权限。

## Protocol boundary

Workspace 注册记录包含：

- provider 分配的稳定 identity；
- provider 解释的工作位置；
- 显示标题和状态；
- 注册表中的持久顺序；
- 可选的 Session 归属索引。

以下内容不属于 WorkspaceCatalog：

- 文件、目录项和文件内容；
- cwd 下的 shell 或进程；
- Git repository、branch 或 source-control 状态；
- sandbox、workspace trust 或写权限；
- Agent 生命周期；
- Session event、历史和归档状态；
- 操作系统目录选择器或文件选择器。

实现可以把这些能力建立在同一个本地目录之上，但协议 identity、授权和错误语义仍然分开。

## Roles

### Workspace provider

Workspace provider 拥有 Workspace identity、location canonicalization、注册记录和顺序。它发布 `WorkspaceCatalog` support。

Provider 可以同时实现 `WorkspaceSessions`，也可以把 Session 归属委托给另一 participant。两份 support 只有声明相同 `workspaceDomain` 并在协商时明确绑定后，才能共享 WorkspaceReference。

### Workspace client

Workspace client 查询或选择 Workspace，并把 WorkspaceReference 传给 Agent、Session、Filesystem 或 Execution 等协议。Client 不能根据显示路径自行构造 reference，也不能从已知 reference 推断文件访问权限。

### Session index provider

Session index provider 维护 Workspace 与 SessionReference 的关系和手动顺序。它不拥有 Session 内容、生命周期或归档语义。

## Shared model

### WorkspaceReference

```ts
interface WorkspaceReference {
  readonly provider: string
  readonly id: string
}
```

`provider` 是当前 agreement 中的 Workspace provider participant identity。`id` 在该 provider incarnation 内唯一，并且不是 path、title 或 URI。

删除注册记录后重新注册同一 location 可以产生新的 id。旧 reference 不得因为 location 再次出现而自动指向新记录。

Reference 用于寻址，不是 bearer credential。每个操作仍检查 agreement、client scope、permission 和当前记录状态。

### Workspace domain

```ts
interface WorkspaceDomainReference {
  readonly id: string
}
```

Provider 在 support 中声明 `workspaceDomain`。Catalog、Session index 及使用 WorkspaceReference 的其他协议据此确认它们引用同一 identity space。

Domain id 只在当前 endpoint view 中用于协议关联，不是跨安装的全局名称，也不是授权 principal。

### Locator and location

Workspace locator 是 client 希望 provider 解析或注册的位置：

```ts
interface WorkspaceLocator {
  readonly kind: string
  readonly spec: unknown
}
```

Locator 由相应 kind 的 definition 校验。Provider 负责 platform-specific normalization、symlink 处理、存在性检查和等价判断；client 不对服务端 locator 做 path join、realpath 或大小写折叠。

`file` locator 表示 provider execution world 中的目录：

```ts
interface FileWorkspaceLocator extends WorkspaceLocator {
  readonly kind: 'file'
  readonly spec: {
    readonly path: string
  }
}
```

`path` 必须是在 provider execution world 中完全限定的路径。相对路径、仅在 client 上有效的路径和未经 provider 解析的 `file:` URI 不能作为 `file` locator。

Provider 返回经过自身解释的 location：

```ts
interface WorkspaceLocation {
  readonly kind: string
  readonly display: string
  readonly canonical?: WorkspaceLocator
}
```

`display` 只用于展示。`canonical` 可以省略，例如 provider 不允许向当前 client 公开底层路径时。Client 不能把 display string 回传为 locator。

### Descriptor

```ts
interface WorkspaceDescriptor {
  readonly workspace: WorkspaceReference
  readonly title: string
  readonly location: WorkspaceLocation
  readonly state: WorkspaceState
  readonly revision: number
  readonly createdAt?: string
  readonly updatedAt?: string
}

type WorkspaceState =
  | 'available'
  | 'missing'
  | 'inaccessible'
  | 'unknown'
```

`title` 是显示属性，不是 identity。客户端不能按 title 寻址；不同 Workspace 可以具有相同 title，Provider policy 也可以拒绝某些名称。

`missing` 表示 location 当前不存在，注册记录仍然有效。`inaccessible` 表示 provider 能识别 location，但当前无法使用。`unknown` 表示本次 snapshot 没有执行可用性探测。

Status 是观察结果，不是后续文件或进程操作的授权证明。其他协议在执行时重新检查各自的 target、containment 和 permission。

### Revision

Catalog 具有单调递增的 `catalogRevision`，每条 Workspace 记录具有自己的 `revision`。Catalog snapshot 表示某一 catalog revision 下的完整、有序记录集合。

记录字段或 Session 归属改变，不一定都改变同一 revision。每个 kind 只负责自己的 revision；client 不能比较不同 kind 的数字来推断先后关系。

## `WorkspaceCatalog`

### Declaration

```ts
type WorkspaceCatalogOperation =
  | 'list'
  | 'get'
  | 'resolve'
  | 'register'
  | 'rename'
  | 'unregister'
  | 'reorder'
  | 'status'
  | 'watch'

interface WorkspaceCatalogRequirementSpec {
  readonly operations: readonly WorkspaceCatalogOperation[]
  readonly optionalOperations?: readonly WorkspaceCatalogOperation[]
  readonly locatorKinds?: readonly string[]
  readonly mutationConcurrency?: 'serialized' | 'revision-checked'
}

interface WorkspaceCatalogSupportSpec {
  readonly workspaceDomain: string
  readonly operations: readonly WorkspaceCatalogOperation[]
  readonly locatorKinds: readonly string[]
  readonly mutationConcurrency: 'serialized' | 'revision-checked'
  readonly limits?: WorkspaceCatalogLimits
}
```

Requirement 中的 `operations` 必须全部得到满足。`locatorKinds` 表示 client 必须能够提交的 locator；Provider 不得仅因理解 unknown locator 的外壳就声明支持该 kind。

`serialized` 表示 Provider 按接纳顺序串行提交 mutation，但不接受 revision precondition。`revision-checked` 在此基础上提供与 mutation 原子执行的 revision compare-and-swap。Requirement 省略 `mutationConcurrency` 时接受 `serialized`；指定 `revision-checked` 时，协商必须选择相同模式。

Catalog mutation 中的 `expectedRevision` 或 `expectedCatalogRevision` 只在 `revision-checked` agreement 中有效。`serialized` agreement 收到这些字段时返回 operation-invalid，不能在临界区外进行一次不可靠的预检查。

Agreement 记录 provider、clients、workspace domain、operations、locator kinds、mutation concurrency 和 limits。同一 client 对应多个可用 provider 且没有显式选择时，协商返回歧义，不以注册顺序决定。

### List and get

```ts
interface WorkspaceCatalogSnapshot {
  readonly catalogRevision: number
  readonly workspaces: readonly WorkspaceDescriptor[]
}
```

`list` 返回当前 client scope 可见的完整、有序 snapshot。它不是 endpoint 上所有用户和所有 provider 的全局枚举。

`get` 按 WorkspaceReference 返回 descriptor。Reference 属于其他 provider、domain 或 agreement 时返回 reference mismatch，不得退化为按 id string 全局搜索。

### Resolve

`resolve` 对 locator 执行 canonicalization 和已有记录查询：

```ts
interface ResolveWorkspaceInput {
  readonly locator: WorkspaceLocator
}

interface ResolveWorkspaceResult {
  readonly workspace?: WorkspaceDescriptor
  readonly location?: WorkspaceLocation
}
```

Resolve 不创建目录、不写注册表，也不改变排序。Location 有效但尚未注册时，结果可以只有 `location`。

无法访问 locator 与 location 有效但未注册是不同结果。Provider 不能把权限错误伪装为任意未注册路径，除非 peer disclosure policy 明确要求隐藏其存在性。

### Register

`register` 为已经存在且符合 provider policy 的 location 创建记录，或返回已有记录：

```ts
interface RegisterWorkspaceInput {
  readonly locator: WorkspaceLocator
  readonly title?: string
  readonly requestId: string
}

interface RegisterWorkspaceResult {
  readonly workspace: WorkspaceDescriptor
  readonly created: boolean
}
```

相同 canonical location 在同一 workspace domain 中至多对应一条 live 注册记录。重复 register 返回该记录且 `created` 为 false；不得因调用者传入不同 title 而静默重命名已有记录。

`requestId` 为当前 client scope 提供幂等重试。相同 request id 与不同输入返回 conflict。

Register 不创建 locator 指向的目录。创建目录属于 Filesystem 或 Directory Creation 协议；成功创建后，client 可以把该协议返回的 locator 交给 register。

### Rename

```ts
interface RenameWorkspaceInput {
  readonly workspace: WorkspaceReference
  readonly title: string
  readonly expectedRevision?: number
}
```

Rename 只修改显示标题，不重命名或移动 location。Title 在校验前去除首尾空白还是按原样保存，由协议版本明确规定；`v1alpha1` 要求去除首尾空白后非空，并保存去除后的值。

Agreement 使用 `revision-checked` 时，client 可以提交 `expectedRevision`；Provider 必须在同一 mutation 临界区比较并写入，不同则返回 conflict。`serialized` agreement 不接受该字段，各次 rename 按 Provider 接纳顺序提交。成功结果返回完整 descriptor。

### Unregister

Unregister 只删除 Workspace 注册记录及其 Catalog/Session index 归属：

```ts
interface UnregisterWorkspaceInput {
  readonly workspace: WorkspaceReference
  readonly expectedRevision?: number
}
```

它不删除目录、文件、Session、Session 日志、Agent 或其他由 location 派生的资源。未知或已经删除的 reference 返回 `removed: false`，使重试保持幂等。

Provider 必须在返回成功前提交记录删除和 Catalog order 更新。删除后旧 reference 立即失效。

### Reorder

```ts
interface ReorderWorkspaceInput {
  readonly workspace: WorkspaceReference
  readonly before?: WorkspaceReference
  readonly expectedCatalogRevision?: number
}
```

Reorder 使用 insert-before 语义；省略 `before` 表示移到末尾。Source 或 anchor 不属于 mutation 执行时的 catalog 时整体失败。以自身为 anchor 或已经位于目标位置是无写入的成功。

Revision precondition 遵循 agreement 的 mutation concurrency；Provider 不能先在临界区外检查 revision，再排队执行 reorder。

最近活动、Session 新消息和 Agent 运行状态不能隐式改变手动 Workspace order。

### Status

`status` 对 Workspace location 执行当前可用性检查，并返回带新观察状态的 descriptor。缺失或不可访问不自动 unregister，也不改变 title、order 或 Session 归属。

`list` 和 `get` 可以返回缓存状态或 `unknown`；它们不必为了展示列表而访问每个远端或网络文件系统。

### Watch

`watch` 从一份 Catalog snapshot 开始，随后产生以下变化：

- workspace registered；
- descriptor changed；
- workspace unregistered；
- catalog order changed；
- catalog invalidated。

每个 event 包含前后 catalog revision。出现序列空洞或收到 invalidated 后，client 重新调用 `list`；event stream 不依赖 client 保存无限增量。

## `WorkspaceSessions`

### Declaration

```ts
type WorkspaceSessionsOperation =
  | 'list'
  | 'attach'
  | 'detach'
  | 'reorder'
  | 'watch'

interface WorkspaceSessionsRequirementSpec {
  readonly operations: readonly WorkspaceSessionsOperation[]
  readonly optionalOperations?: readonly WorkspaceSessionsOperation[]
  readonly mutationConcurrency?: 'serialized' | 'revision-checked'
}

interface WorkspaceSessionsSupportSpec {
  readonly workspaceDomain: string
  readonly sessionDomain: string
  readonly operations: readonly WorkspaceSessionsOperation[]
  readonly mutationConcurrency: 'serialized' | 'revision-checked'
}
```

WorkspaceSessions agreement 必须绑定能够产生相应 WorkspaceReference 与 SessionReference 的 domain。相同 id string 不能跨 domain 匹配。

### Membership snapshot

```ts
interface WorkspaceSessionSnapshot {
  readonly workspace: WorkspaceReference
  readonly revision: number
  readonly sessions: readonly SessionReference[]
}
```

`sessions` 使用 provider 持久保存的手动顺序。Snapshot 只表示归属，不包含 Session title、消息、运行状态或归档状态；client 从 Session 协议取得这些数据。

一个 Session 在同一 workspace domain 中至多归属于一个 Workspace。没有归属的 Session 仍然有效，并可以由 Session catalog 作为 ungrouped 项目展示。

### Attach and detach

Attach 把一个已经存在的 Session 归入 Workspace：

```ts
interface AttachWorkspaceSessionInput {
  readonly workspace: WorkspaceReference
  readonly session: SessionReference
  readonly expectedRevision?: number
}
```

Session descriptor 已记录 Workspace provenance 时，该 reference 必须与目标 Workspace 相容。没有 provenance 时，Provider 必须从受信 Session metadata 或自身 policy 得到相容性依据；只凭 client 同时知道两个 reference，不能任意改变归属。

已经归属于目标 Workspace 的 attach 是幂等成功。已归属于另一 Workspace 时，Provider 返回 membership conflict；不能静默从旧 Workspace 移动。

Detach 只移除归属。它不关闭 Agent、不删除 Session，也不改写 Session 中记录的执行位置或来源 Workspace；这些记录是 provenance，不等于当前 WorkspaceSessions membership。

Attach、detach 和 reorder 遵循 agreement 的 mutation concurrency。`revision-checked` Provider 在同一 mutation 临界区检查 membership revision；`serialized` Provider 按接纳顺序提交，不接受 revision precondition。

### Session order

Session reorder 与 Catalog reorder 使用相同的 insert-before 语义，但 revision 属于该 Workspace 的 Session index。新 attach 的默认位置由 agreement 声明；`v1alpha1` 默认置于首位。

Session 活动、消息写入和 Agent status 不改变手动顺序。

### Watch

WorkspaceSessions watch 产生完整 membership revision 变化。出现空洞后重新读取该 Workspace 的 membership snapshot。Session 内容变化不产生 WorkspaceSessions event。

### Visibility filters

隐藏、归档或过滤 Session 是 Session 客户端视图或独立 Session visibility capability，不属于 WorkspaceSessions。此类状态不能隐式删除 Workspace 归属槽位；恢复显示后原有归属和顺序仍然有效。

## Connection binding

Workspace 协议可以在进程内由 scoped SDK 使用，也可以在 `@dsh-std/connection` attachment 上交换类型化 request、response 和 event。

Connection agreement 明确绑定 provider、client 和 domain。Connection Host 不解析路径、不访问目录，也不根据 WorkspaceReference 查找产品 service；这些工作由 Workspace provider 完成。

WorkspaceReference 只在产生它的 provider/domain 中有效。跨 connection 恢复 reference 时，client 必须先重新取得相应 agreement，并由 provider 确认旧 id 仍属于当前 incarnation。

## Errors

协议错误至少区分：

- provider、workspace domain 或 session domain 不匹配；
- Workspace 或 Session 不存在；
- locator kind 未协商或 locator 无效；
- location 不存在、不是目录或当前不可访问；
- location 已注册；
- operation 未协商；
- record 或 catalog revision conflict；
- title 无效或被 provider policy 拒绝；
- reorder source 或 anchor 无效；
- Session 与 Workspace location 不相容；
- Session 已归属于其他 Workspace；
- permission 或 disclosure policy 拒绝；
- catalog 或 membership state invalidated；
- provider unavailable 或持久提交失败。

错误提供稳定 code 和结构化 detail。Provider 不能在未授权 detail 中泄露绝对路径、其他用户的 Workspace、Session identity、credential 或底层存储异常。

## Security considerations

- WorkspaceReference、locator、display path 和 title 都不是文件访问授权。
- Provider 在 resolve/register 时验证 locator，并在每次领域操作中重新检查 client scope。
- 远端路径由 provider 按自己的 execution world 解释；client 不能要求 provider 按 client 平台规则规范化。
- Canonicalization 与 symlink policy 由 provider 执行，结果不能由 client 声称。
- Register 不授予读写、shell 或 Agent control；这些 capability 分别协商和授权。
- Unregister 永不删除目录、文件或 Session。
- Status 结果可能立即过时；文件和 execution provider 仍须在使用时执行 containment 与 policy 检查。
- List/watch 按 peer disclosure policy 裁剪，不能把 endpoint 的完整 Workspace registry 自动公开给所有连接。
- Provider 对 catalog 大小、locator 长度、watch 缓冲、注册频率和并发 mutation 设置限制。

## Relationship to other proposals

- Core 声明并协商 WorkspaceCatalog 与 WorkspaceSessions；
- Connection 承载远端 Workspace message 与 event；
- Agent 使用 WorkspaceReference 选择执行位置，但不拥有 Workspace identity；
- Session 可以用 WorkspaceReference 记录 provenance，并拥有自身内容、历史和生命周期；WorkspaceSessions 单独拥有当前 membership；
- Filesystem 使用 WorkspaceReference 建立相对解析和 containment scope；
- Execution 使用 WorkspaceReference 选择工作目录和 sandbox scope；
- Presentation 或目录选择协议取得用户选择，不直接修改 Workspace catalog；
- Permission 决定可见 Workspace、可接受 locator 和允许的 mutation。

## Rationale and alternatives

### 使用 path 作为 Workspace identity

Path 会因平台、symlink、挂载和 normalization 改变，也可能不应向 client 公开。稳定 id 允许目录暂时缺失，并避免 client 把展示路径当作授权 handle。

### 把 Workspace 与 Filesystem 合并

Workspace 是注册记录，Filesystem 是内容访问能力。只读 Workspace picker 不应自动取得文件内容；同一 Workspace 也可能由本地、容器或远端 filesystem implementation 提供。分别协商可以保留最小权限。

### 让 register 创建目录

注册已有 location 与修改文件系统具有不同权限和失败边界。目录创建完成后再 register，可以保证 Catalog 不需要承担 mkdir、父目录权限和文件系统回滚。

### 删除 Workspace 时删除目录或 Session

UI 中移除一个分组不能推导出销毁用户数据的意图。破坏性删除必须由拥有相应资源的协议提供独立操作与授权。

### 把 Session 可见性存入 WorkspaceSessions

隐藏或归档决定 Session 在客户端中的可见性，即使 Session 没有 Workspace 归属也成立。WorkspaceSessions 只保存归属和顺序，避免把产品视图状态变成 Workspace 的附属状态。

### 按活动时间自动排序

活动排序可以由客户端从 Session status 构造临时 view；覆盖持久手动顺序会使多个客户端之间产生不可预测的重排。协议只保存显式 mutation。

## Drawbacks

Workspace、Filesystem、Execution 和 Session 分开后，完整客户端需要组合多份协议。相应代价换来明确的资源所有权和权限边界。

Locator canonicalization 由 provider 执行，client 不能仅靠本地字符串判断两个 location 是否相同，通常需要一次 resolve round trip。

WorkspaceSessions 保留手动索引会产生 membership 与 Session provenance 的相容性要求。Provider 必须原子提交 membership mutation，或拒绝无法保持相容性的操作；detach 不改写历史 provenance。

## Unresolved questions

### Locator definitions

除 `file` 外，container、repository、virtual workspace 和其他 locator kind 的 schema 与互操作语义尚未确定。新增 kind 必须说明 canonical equivalence 和 display 信息，不能只占用 URI scheme。

### Multi-root workspace

一个 Workspace 是否可以包含多个 location，以及各 root 的名称、顺序和 containment 关系，需要独立语义。`v1alpha1` 的 descriptor 只表示一个主 location。

### Cross-incarnation references

Provider 重启后是否恢复相同 workspace domain/incarnation，以及 client 如何区分恢复的持久记录和被复用的 id，需要与 Connection peer identity 和持久 reference 规则共同确定。
