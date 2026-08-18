# `@dsh-std/tool` 设计提案

- 文档类型：设计提案
- 状态：草案
- 日期：2026-08-16

## Summary

`@dsh-std/tool` 定义用于发现模型工具的 `Tool` resource、供本地同进程 adapter 注册实现的 `ToolHandler`，以及显式接管既有工具实现的 `ToolOverride` extension。Resource 将插件的静态目录信息与 runtime 解析的可用状态、模型说明和参数 schema 分开；本地 handler 与 override 将实现、替换意图、冲突检查归入同一个 owner 生命周期。

本提案不定义跨 endpoint 的通用工具调用协议。

## Motivation

一个工具出现在安装包中，不表示它已在当前 Agent 或 workspace 中激活。工具的参数 schema 还可能延迟生成，或因 policy、平台和配置而暂时不可用。

如果 manifest 必须携带完整 schema，渐进式披露无法减少模型请求中的工具定义；如果只查询运行时工具对象，客户端又无法在加载实现前建立目录。

`Tool.spec` 保存稳定的目录信息，`Tool.status` 保存 runtime 当前能够证明的状态。

## Guide-level explanation

Facet 在自身 `extensions` 中贡献静态 resource：

```ts
{
  apiVersion: 'tools.dsh/v1alpha1',
  kind: 'Tool',
  metadata: { name: 'search_tools' },
  spec: {
    title: 'Search tools',
    description: 'Search the active tool catalog.',
  },
}
```

Runtime 可以只报告工具可用，而暂不披露 schema：

```ts
{ state: 'available' }
```

需要完整参数时，runtime 再投影 `parameters`：

```ts
{
  state: 'available',
  description: 'Search currently mounted tools.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
  },
}
```

客户端可以用 `metadata.name` 建立稳定目录，用 status 决定是否向用户或模型显示当前 schema。

Facet 与产品 adapter 在同一进程中运行时，可以随 resource 发布本地 handler。Handler 返回的定义只包含惰性 JSON Schema、执行函数与并发安全分类；adapter 把它注册到产品工具 runtime，并为每次调用注入宿主管理的执行设施。函数、`Uint8Array` 和 attachment reference 不进入 manifest、snapshot 或 endpoint 传输。

组件需要包装或替换既有工具时声明 `ToolOverride`：

```yaml
apiVersion: tools.dsh/v1alpha1
kind: ToolOverride
metadata:
  name: openai-codex-read-image
spec:
  target: read_image
  description: Accept HTTP(S) image sources before delegating local paths.
```

激活代码只发布该 extension 的 handler。产品 adapter 负责把 handler 应用到当前及以后建立的 tool view，并在 owner 停用时恢复原定义。

## Reference-level explanation

### Tool spec

```ts
interface ToolSpec {
  readonly title: string
  readonly titles?: Readonly<Record<string, string>>
  readonly description: string
}
```

`title` 面向用户；`description` 是静态目录说明。`titles` 按 locale 提供显示文本。Tool 的稳定名称来自 resource `metadata.name`。

### Tool status

```ts
interface ToolStatus {
  readonly state: 'available' | 'unavailable'
  readonly description?: string
  readonly parameters?: Readonly<Record<string, unknown>>
  readonly reason?: string
}
```

`description` 是 runtime 解析后的模型说明，可以覆盖静态目录文案。`parameters` 是惰性、不可执行的 JSON Schema 数据；省略它不改变 `available` 状态。

`reason` 只用于 `unavailable`。Available status 包含 `reason` 时校验失败。

协议不从 `parameters` 是否存在推断工具是否可调用，也不把 JSON Schema validator 或函数对象放入 resource。

### Discovery boundary

Tool descriptor 可以出现在 facet manifest、runtime snapshot 或领域目录中。无论通过哪种载体读取，其字段语义相同。Manifest extension 只提供静态 `spec`；runtime status 必须来自实际工具目录，不能写回 manifest。

以下行为不属于 resource 的远程发现语义：

- 跨 endpoint 执行工具；
- 流式传输工具结果；
- 请求审批；
- 应用 sandbox 或 policy；
- 记录模型 tool call；
- 渲染结果附件。

这些行为需要 runtime 内部接口或独立协议。本包定义的 `ToolHandler` 仅是 activation 与 adapter 之间的本地 value，不构成远程 capability。

### 本地可执行定义

`ToolHandler.resolve()` 返回 `ExecutableToolDefinition | undefined`。定义的 `name` 必须等于 resource name；`description`、`parameters` 与 `output` 必须是可惰性处理的 JSON Schema 数据，`execute()` 必须返回 canonical JSON data 及由宿主 attachment reference 组成的 model-facing content。`subscribe()` MAY 通知 adapter 重新求值动态定义。

Adapter MUST 为每次已接受的调用创建 `ToolExecutionContext`，并保持宿主的取消信号和当前模型路由。若宿主提供图片服务，adapter MUST 投影部署生效的图片限制，并通过宿主实现完成 `validateImage`、`saveImage` 和最近会话图片读取。图片引用 MUST 保持为宿主 opaque reference；组件 MUST NOT 从中推断文件路径或 bearer URL。

Workspace 读取 MUST 使用当前 session 的 cwd 与宿主 filesystem，完成读取后 MUST 发出宿主规定的 observed 记录。Workspace 写入 MUST 先经过宿主 write-intent waterfall，再应用当前 sandbox policy；本地文件写入 MUST 使用同目录临时文件和原子发布，远端文件系统则 MUST 调用其 binary writer。成功写入后 adapter MUST 发出带新 version 的 observed 记录。

嵌套工具执行时，adapter MAY 暴露 `deferContent()`，并 MUST 将其转换为宿主的 deferred context，而不是直接修改父级 session。`ToolOverride` 上下文还 MUST 暴露 `delegate()`，以同一宿主 execution 调用被替换定义并保留其原生渲染结果。

### Tool override

```ts
interface ToolOverrideSpec {
  readonly target: string
  readonly description: string
}

interface ToolOverrideHandler {
  resolve(original: ExecutableToolDefinition): ExecutableToolDefinition | undefined
  subscribe?(invalidate: () => void): () => void
}
```

`target` 是被接管工具的稳定名称。`metadata.name` 标识 override 本身，两者不能互换。

`resolve()` 接收当前 tool view 继承的原定义，并返回同名替换定义。返回 `undefined` 表示当前策略暂不启用 override。Handler 不注册工具、不枚举 Agent，也不监听产品事件；这些工作由 adapter 完成。

动态 policy 改变后，handler 通过 `subscribe()` 发出失效通知。通知只表示 adapter 应重新求值，不携带产品对象，也不直接修改 registry。

同一 composition scope 中，一个 `target` 最多存在一个 live `ToolOverride` owner。多个不同名称的 override 指向同一 target 仍构成 composition error。协议不按加载顺序叠加 decorator，因为未声明的顺序会改变工具执行语义。

Adapter 必须对以下情况执行原子回滚：handler 缺失或形状无效、目标返回了不同名称、产品 tool view 已有无法归属的同层 shadow，以及注册替换定义失败。Facet 停用时，adapter 撤销全部由该 activation instance 建立的 shadow。

工具不存在时，override 保持已声明但不产生替换定义；目标稍后出现时 adapter 重新求值。产品具有多个隔离 tool view 时，adapter 必须把相同声明应用到其负责的每个 view，而不是要求组件监听 view 创建事件。

## Drawbacks

Tool resource 无法让发现它的远程客户端直接执行工具。客户端需要另一个执行接口，且必须维护 resource identity 与执行目标之间的映射。本地 `ToolHandler` 只解决 facet 与同进程 adapter 的注册，不改变这项限制。

`parameters` 目前只声明为 JSON object，没有固定 schema dialect。不同消费者对关键字的支持可能不一致。

允许 available tool 省略 schema 适合渐进式披露，但客户端不能把 `available` 解释为“已经取得调用所需的全部描述”。

## Rationale and alternatives

### 把完整 schema 放入 spec

静态 spec 易于索引，但会迫使插件在安装时固定 runtime schema，也无法表示按 policy 或 environment 生成的参数。当前设计把 schema 放入 status。

### 用 `deferred` 作为第三种 state

Schema 是否已披露与工具是否可用是两个维度。Available status 省略 `parameters` 已能表达“工具可用，但 schema 尚未投影”，无需增加状态枚举。

### 同时定义 ToolRuntime

发现和执行的权限、生命周期及错误语义不同。`v1alpha1` 先稳定发现资源；执行接口需要单独提案。

## Unresolved questions

### Schema dialect

需要决定 `parameters` 使用的 JSON Schema dialect，以及消费者遇到未知关键字时的行为。

### Description ownership

Runtime description 是否覆盖静态 description，还是应保留两者供不同消费者选择，需要在目录 API 中明确。

### Tool execution

跨 endpoint 执行是否采用统一 `ToolRuntime`、每个工具的具名 operation，或继续由 Agent runtime 所有，尚未决定。

### Change notification

工具挂载、卸载和 schema 披露变化是否需要 Tool 专用订阅，仍待确定。`ToolOverrideHandler.subscribe()` 只使 adapter 重新计算本地 override，不是面向目录消费者的变化流。
