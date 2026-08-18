# `@dsh-std/command` 设计提案

- 文档类型：设计提案
- 状态：草案
- 日期：2026-08-16

## Summary

`@dsh-std/command` 定义声明式 `Command` extension 和命令目录、执行协议。Facet 在 manifest 中贡献命令结构；产品 adapter 负责把这些声明与实际命令 handler 关联。

## Motivation

命令通常由插件注册在某个产品的内部命令服务中。外部客户端如果直接读取该服务，会依赖产品类型；如果插件各自定义远端 RPC，客户端又需要认识每个插件。

Command extension 让客户端在不加载命令插件的情况下构建命令列表、补全树或表单。协议的目录与执行部分规定实现间如何交换和调用命令，同时保留命令归属和运行时检查。

## Guide-level explanation

Facet 在自身 `extensions` 中贡献一个根命令：

```ts
{
  apiVersion: 'commands.dsh/v1alpha1',
  kind: 'Command',
  metadata: { name: 'account' },
  spec: {
    title: 'Manage account',
    placements: [
      { apiVersion: 'x-example.tui/v1alpha1', kind: 'CommandLine' },
    ],
    children: [
      { name: 'login', spec: { title: 'Sign in' } },
      { name: 'logout', spec: { title: 'Sign out' } },
    ],
  },
}
```

客户端通过 command 协议的 `catalog` 操作获得当前 context 中可见的命令。目录项同时包含 command descriptor、所属 participant、运行时可用状态和缺失的 presentation protocol。

执行时，客户端把原始命令行和 opaque `contextId` 交给 runtime：

```ts
const call = commandRuntime(client).execute({
  contextId: sessionId,
  line: '/account login',
})
```

标准不解释 `contextId`。DSH adapter 可以把它映射为 session，其他 runtime 可以采用自己的上下文标识。

## Reference-level explanation

### Command tree

`CommandSpec` 描述根节点；`children` 递归描述子命令。节点可以包含：

- `title`、`titles` 和 `description`；
- 单 token 的 alias；
- 位置参数；
- option；
- 子命令。

同级命令名称和 alias 不能冲突。参数名、option spelling 和枚举值在各自作用域内唯一。Variadic 参数只能位于参数列表末尾。

本协议不规定 tokenizer、quote、escape 或 option 排列规则。`execute.line` 的解释由 runtime 使用的命令系统负责。

### CommandReference

```ts
interface CommandReference {
  readonly name: string
  readonly path?: readonly string[]
}
```

Reference 指向一项已声明 command 及其子命令路径。它不是 shell command，也不包含参数。其他 resource 可以用它引用管理操作。

### Catalog

```ts
interface CommandCatalogInput {
  readonly contextId: string
  readonly presentation?: PresentationDescriptor
}
```

`presentation` 描述当前客户端可执行的 presentation contract。Runtime 根据 command 所属 facet 的 requirement 计算 `missingPresentation`，并结合 composition 结果设置 `available`。

`CommandSpec.placements` 是可选的 surface 坐标集合。它声明哪些人机命令 surface 可以发布该命令；省略时表示任意已注册的 command surface 均可发布。坐标由 surface 所有者定义，Command 协议不枚举 Web、Desktop、TUI、CLI 或其他产品类别。

`CommandCatalogInput.placement` 允许 consumer 请求某个精确 surface 的目录。Runtime 必须排除显式 `placements` 不包含该坐标的命令。省略 `placement` 返回当前 context 的完整标准目录，不等同于任何默认 UI。

Catalog 中不存在对应实际命令 handler 的 descriptor 不会成为可执行目录项。产品 adapter 负责把 manifest extension 和权威 handler 连接起来。命令进入某个产品命令 registry，必须由该 surface 的 provider 显式完成；profile 名称和进程入口不能代替 placement 协商。

### Execute

`CommandRuntime.execute` 返回 `CommandExecution | undefined`。`undefined` 表示 runtime 未识别该根命令。已识别命令返回：

- `commandId`；
- success 或 error result；
- 可选文本和源事件序号。

执行前，runtime 检查命令所属 activation instance 仍为 active，并检查必需 presentation contract。需要用户交互的 handler 通过 invocation-scoped `PresentationClients` 直接调用已经协商的 OpenExternal、Notification 或 UserInteraction；handler 不能调用所属 facet 未声明 requirement 的 presentation kind。

Presentation request 与 command invocation 共享 cancellation 和 deadline。Command result 不携带延迟执行的任意 UI operation；interaction 已经 settled 或 cancelled 后，Command 才返回依赖该结果的业务状态。

### Protocol implementation

一个产品可以提供聚合的 command protocol implementation。不同 facets 贡献具名 `Command` extension；目录实现只发布实际存在且当前可见的命令。产品中的 TUI 输入框、浏览器命令面板或桌面 command palette 可以分别注册自己的 surface provider，并只投影 placement 匹配的命令。标准执行不依赖这些人机 surface，因此设置页或远端 API 可以调用未投影到自身界面的命令。

协议包可以提供类型化 client、message validator 和参考 dispatcher。跨 endpoint 使用时，command definition 生成自己的 connection agreement，并在 connection attachment 上交换这些 message。

## Drawbacks

声明式 grammar 只能表达常见的参数、option 和静态枚举值。使用自定义 parser 的命令可能无法完整投影为 `CommandSpec`。

执行输入仍是原始字符串，因此客户端生成的结构化表单最终需要序列化为 runtime 能解析的命令行。

聚合目录是单点映射层。Adapter 必须维护 extension ownership 与产品命令 registry 的一致性。

## Rationale and alternatives

### 每个插件提供一个 command capability

这种方式会让客户端先理解并选择每个 component。具名 command descriptor 和聚合目录可以同时保留 facet 归属与统一调用语义。

### 在 manifest extension 中保存回调或 RPC method

可执行值无法跨进程，也无法在加载插件前读取。Extension 只保存声明，handler 由产品实现持有。

### 用字符串引用管理命令

把 `/account login` 存为字符串会混入具体 parser 的 quote 和 escape 规则。`CommandReference` 使用名称与路径，调用时再由客户端或 runtime 组合参数。

## Unresolved questions

### Structured execution

后续版本是否增加按 command path、argument 和 option 传递的结构化执行操作，尚未决定。

### Dynamic completion

`v1alpha1` 只有静态 `values`。依赖 context 或远端状态的补全需要新的 operation 或独立 completion capability。
