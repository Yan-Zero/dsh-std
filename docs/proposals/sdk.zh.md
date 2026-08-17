# `@dsh-std/sdk` 设计提案

- 文档类型：设计提案
- 状态：探索性草案
- 日期：2026-08-16

## Summary

`@dsh-std/sdk` 为 TypeScript component 提供标准协议的受限 facade、生命周期 cleanup 和声明辅助函数。它是参考开发库，不是协议本身，也不是 Host API 的全量镜像。

Facet activation 只取得该 facet 在 manifest 已声明、composition 已接纳、core 已协商并由 permission grant 允许的 API。产品实现通过 adapter 为 SDK context 提供后端。

## Motivation

如果插件直接接收产品的完整 context，静态 capability declaration 只剩文档作用。插件仍能查找未声明 service、绕过 owner cleanup，或依赖 DSH/Cordis 的内部形状。

另一方面，要求每个插件手工处理 core declaration、connection attachment、permission handle 和 schema validator，会产生重复且不一致的代码。

SDK 把协议级 API 组装成 activation-instance-scoped context，同时保持产品实现可替换。

## Guide-level explanation

TypeScript 实现可以使用 `defineFacet()` 声明 activation module：

```ts
export default defineFacet(async context => {
  const commands = context.protocol(commandProtocol)
  const storage = context.permission(storagePermission)

  context.events.observe(sessionCreated, event => {
    // event payload is validated and immutable
  })

  context.cleanup.add(() => storage.flush())
})
```

`context.protocol()` 不接受任意字符串。调用方传入协议包导出的 typed key，SDK 再检查当前 activation instance 的 agreement。

`context.permission()` 返回 scoped API，而不是可序列化 grant。未声明、未协商或未授权时，SDK 返回结构化不可用结果或在必需项上阻止 activation。

## Reference-level explanation

### SDK context

SDK context 至少包括：

- component、facet 与 activation instance identity；
- manifest 和 composition plan 的只读投影；
- typed protocol access；
- permission-scoped APIs；
- event subscription facade；
- lifecycle cleanup scope 和 abort signal；
- owner-aware background task；
- 结构化 diagnostics。

Context 不暴露通用 `getService(name)`、裸 connection、任意 event name 或产品 root context。

### Publication APIs

SDK 区分“使用已协商协议”和“发布本 facet 的实现或 extension handler”：

```ts
context.protocols.implement(protocolKey, implementation)
context.extensions.publish(extensionKey, extensionId, handler)
```

`implement()` 只能登记 facet manifest 的 `protocols.supports` 已声明的协议。`publish()` 只能绑定该 facet 已声明的 extension identity。两者都先进入 staging，并由 lifecycle publication barrier 原子转为 live；调用函数本身不允许修改静态 manifest 或立即伪造 live declaration。

`implement()` 把 support 登记到 coordinator 为当前 activation instance 分配的 component participant。第一版 SDK 不允许实现代码自行构造 participant identity；需要独立 participant 的功能应拆成另一 facet。产品内建实现可以绕过组件 SDK，由产品直接创建可归属 participant。

### Protocol keys

每个 TypeScript 协议包可以导出不可伪造的 `ProtocolKey<Client>`。Key 包含协议 reference、schema/validator 和把本地实现或 connection attachment 适配为 typed client 的方法。

SDK backend 只为当前 agreement 中存在的协议签发 client。协议包可以没有 TypeScript key；其他语言或手写实现仍按协议对象和消息语义互操作。

### Optional protocols

Manifest 中的 optional requirement 在 context 中表现为显式可用性：

```ts
const presentation = context.optionalProtocol(openExternalProtocol)
if (presentation.available) await presentation.client.open(uri)
```

SDK 不为缺失可选协议注入会在首次调用时才崩溃的占位实现。

### Ownership and cleanup

SDK 创建的 registration 全部绑定 activation instance lifecycle scope。Protocol implementation、extension handler、event handler、timer、task 和 connection attachment 都返回 disposer，并自动登记 owner。

Activation scope 关闭后，旧 context 与全部 typed client 进入 revoked 状态。Reload 后的新 instance 获得新 context，不能继承旧 handle。

### Product backend

SDK 通过一个最小 backend interface 接收已验证的 plan、agreement、grant 和 registration primitive。DSH adapter、独立 Host 或测试 harness 可以分别实现该 backend。

Backend 不是远端协议。跨进程操作仍通过 connection attachment 和相应领域协议完成；SDK 不把本地 service lookup 暴露为隐式 RPC。

### Manifest helpers

SDK 可以提供 `defineManifest()`、`defineFacet()` 和协议 extension builder，以获得 TypeScript 类型检查。最终发布物仍包含静态 `manifest.yaml`；运行 JavaScript helper 不是读取 manifest 的前置条件。

Builder 输出必须能规范化为 manifest schema，不能生成只有该 SDK 能解释的函数或 symbol。

## Security considerations

Typed facade 减少误用，但不能把同进程 JavaScript 变成安全沙箱。恶意代码仍可调用 Node.js 或其他全局 API；强隔离由 worker/process sandbox 和产品 policy 提供。

SDK handle 使用对象身份或不可伪造 brand，不接受 plugin id、grant id 或 agreement id 换取权限。

## Drawbacks

产品专用高级 API 不一定有标准协议。插件需要选择降级、声明 DSH 专属 module，或先提出新协议。

Typed key 方便 TypeScript，却需要协议包维护 client adapter 与 schema 版本。其他语言要提供自己的 SDK 或直接实现协议。

## Rationale and alternatives

### 把完整 Host context 传给插件

这无法执行静态声明与 permission grant，也让插件绑定产品内部 API。SDK context 按当前 facet activation instance 的 plan 构造最小 facade。

### 通过字符串查询协议

字符串 lookup 难以在编译期发现版本和 operation 漂移，也容易绕过 owner。Typed key 只是本地开发辅助；wire identity 仍使用标准 `apiVersion` 与 `kind`。

### SDK 自己加载插件

加载、隔离和 profile 管理属于产品。SDK 只描述 facet activation surface，实际 lifecycle coordinator 由 adapter 或其他产品实现负责。

## Unresolved questions

### Package granularity

基础 SDK 与 DSH-specific convenience 是否分成 `@dsh-std/sdk` 和 `@dsh-std/adapter-dsh/sdk`，需要根据首批真实插件的依赖大小确定。

### Generated clients

协议 client 是否从 schema/IDL 生成，还是由协议包手写，需要等 connection messaging profile 与 schema dialect稳定后再决定。
