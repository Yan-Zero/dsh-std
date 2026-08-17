# `@dsh-std/model` 设计提案

- 文档类型：设计提案
- 状态：草案
- 日期：2026-08-16

## Summary

`@dsh-std/model` 定义具名 `ModelProvider` resource、对应的运行时 handler 和共享的 `ModelCatalog` capability。Resource 描述已安装的模型集成及其当前状态；handler 接收 provider-neutral 请求并产生流式结果；Catalog 为客户端提供统一的 `list` 和 `get` 操作。

## Motivation

模型集成存在两类信息：

- 不运行插件即可读取的名称和管理入口；
- 登录、配置和运行环境确定后的可用状态与模型列表。

把二者都编码为某个产品的设置页面，会使其他客户端无法发现 provider。把每个 provider 直接注册成 connection capability，又会产生多个同类 provider，并把模型目录查询与推理调用混为一谈。

具名 resource 用于表达 provider，唯一的 Catalog capability 用于查询当前 endpoint 的 provider 集合。

## Guide-level explanation

模型 facet 在自身 `extensions` 中贡献一项 resource：

```ts
{
  apiVersion: 'models.dsh/v1alpha1',
  kind: 'ModelProvider',
  metadata: { name: 'example-provider' },
  spec: {
    title: 'Example Provider',
    actions: {
      authenticate: { name: 'account', path: ['login'] },
    },
  },
}
```

运行时为该 resource 投影 status：

```ts
{
  state: 'authentication-required',
  models: [
    { id: 'example-model', name: 'Example Model', selectable: false },
  ],
}
```

客户端通过 `modelCatalog(client).list()` 获取全部 provider，或用 resource name 调用 `get()`。

Facet 激活时以同一 resource name 发布 `ModelProviderHandler`。Handler 的 `listModels()` 返回 provider 当前模型目录，`stream()` 执行一次模型请求。产品 adapter 将自身的消息、附件引用和流事件转换到该接口；provider 组件不导入产品的 LLM registry。

## Reference-level explanation

### ModelProvider spec

`ModelProviderSpec` 包含显示标题、本地化标题和可选 `actions`。支持的 action 为：

- `authenticate`；
- `signout`；
- `configure`。

每个 action 使用 `CommandReference`，指向 `@dsh-std/command` 中已声明的命令路径。Model 协议不复制命令参数，也不保存可执行 callback。

### ModelProvider status

Provider state 为：

- `ready`：provider 可以参与当前运行时的模型选择；
- `authentication-required`：provider 已安装，但需要完成认证；
- `unavailable`：provider 当前无法使用。

Status 始终包含 `models`。每个 model 包含 provider 内唯一的 `id`、显示名称、可选说明、`selectable` 和可选原因。

Provider state 与 model selectability 分别表示集成整体状态和单个模型状态。客户端不能仅根据 provider 为 `ready` 推断每个 model 都可选择。

### ModelCatalog

```ts
type ModelCatalogCall =
  | { operation: 'list'; input: {}; output: ModelCatalog }
  | { operation: 'get'; input: { name: string }; output: ModelProviderCatalogEntry | undefined }
```

Catalog entry 包含带 status 的 resource、catalog-scoped owner reference、运行时可用状态和可选消息。若 owner participant 已在当前协议 agreement 中公开，entry 可以引用该 participant；catalog 不因本地 provenance 存在就自动公开 component 或 facet identity。

一个 endpoint 只实现一个 `ModelCatalog`。Adapter 汇总 selected facets 中已经通过运行时校验的 `ModelProvider` resources；模型 facet 本身不因此实现 Catalog。

`get.name` 使用 resource 的 `metadata.name`，不是 provider 显示标题或 model id。

### ModelProvider handler

`ModelProviderHandler` 是 resource 的本地可执行实现：

```ts
interface ModelProviderHandler {
  listModels(): readonly ModelDescriptor[] | Promise<readonly ModelDescriptor[]>
  stream(request: ModelGenerateRequest, context: ModelExecutionContext): AsyncIterable<ModelStreamChunk>
}
```

`ModelGenerateRequest` 使用 `@dsh-std/content` 的 ContentBlock，并由本协议定义 message role、tool schema、采样参数和调用用途。图片和其他二进制 block 携带 ContentReference；handler 只能通过 invocation-scoped content client 读取已授权字节。取消由 `context.signal` 传递。

Handler 由所属 facet 发布，并随 activation instance 一同撤销。Adapter 验证 handler 后，将它映射到产品自身的模型 registry。组件不得自行查找或调用某个产品 adapter。

`ModelCatalog` 仍只处理发现。它不通过 connection 转发 prompt 或 token stream；远端模型执行需要单独协商的调用协议。

## Drawbacks

Catalog 返回 snapshot，没有提供变化事件。频繁变化的认证或模型状态需要客户端重新查询。

Model descriptor 是多个 provider 的公共子集，无法表达 provider 特有的上下文窗口、价格、输入模态或推理参数。

管理 action 依赖 command 协议。没有 CommandRuntime 的客户端可以显示 provider，但不能通过标准接口完成管理流程。

## Rationale and alternatives

### 每个 provider 作为 capability provider

这会让 connection 对同一 catalog contract 出现多个实现。具名 resource 用于并列条目，共享 Catalog 用于查询，避免 provider 选择成为 connection resolver 的职责。

### 把登录状态放入 spec

认证状态属于运行环境，并可能在进程存活期间变化。`spec` 保持静态，`status` 由 runtime 所有。

### 在 model 协议中定义登录 RPC

不同 provider 的登录流程差异很大，并可能需要浏览器、设备码或配置表单。引用声明式 command 可以复用现有交互机制。

## Unresolved questions

### Model metadata

上下文窗口、模态、推理强度、价格和能力标签是否需要进入公共 descriptor，尚未确定。新增字段前需要至少两个独立 provider 的实现经验。

### Catalog subscription

认证完成、配置变化或动态模型列表变化时，是否由 ModelCatalog 提供订阅，还是使用通用 resource snapshot 事件，尚未决定。

### Remote inference

本提案中的 handler 是 endpoint 内部的 facet-to-runtime 边界。远端客户端控制完整 Agent 时使用 AgentControl，不因 ModelCatalog 可见就获得 prompt 或 token stream 调用。只有出现独立 Model execution provider/consumer 的互操作需求时，才定义相应调用协议。
