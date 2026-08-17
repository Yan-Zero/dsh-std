# `@dsh-std/events` 设计提案

- 文档类型：设计提案
- 状态：探索性草案
- 日期：2026-08-16

## Summary

`@dsh-std/events` 定义版本化 event point 的声明、订阅和分派语义。它明确区分只读 observation 与能够修改或阻断操作的 interception。

Events 标准不建立一张预设的全局事件表。每项领域协议拥有自己的 event kinds、payload 和结果语义。

## Motivation

通用 `ctx.on('before-*')` 很容易演变为隐式控制流：插件依赖字符串名称、注册顺序和共享可变对象，运行时无法提前说明谁能改写请求，也无法在超时后可靠归责。

另一方面，完全没有标准事件会迫使插件 patch 内部方法，失去清理、审计和兼容性检查。

Events 提供统一机制，同时让每个 event point 明确声明自己是观察点还是拦截点。

## Guide-level explanation

领域协议发布 `EventPointDefinition`。例如 session 协议可以定义只读的 `SessionCreated`，tool 协议可以在确有需要时定义可拦截的 `BeforeToolInvoke`。

Facet 通过 manifest 声明要订阅的 event point。Composition 检查 event 是否存在、模式是否允许以及是否有冲突。Lifecycle 在 activation scope 中注册 handler，停用时自动移除。

Observer 收到不可变 event envelope。它的返回值不会影响发布者。

Interceptor 收到协议定义的 draft，并返回结构化 decision。Dispatcher 按显式 order policy 合成 decision；它不共享一个由 handler 随意修改的对象。

## Reference-level explanation

### Event point definition

```ts
interface EventPointDefinition extends ApiReference {
  readonly mode: 'observe' | 'intercept'
  readonly payloadSchema: SchemaReference
  readonly resultSchema?: SchemaReference
  readonly ordering: EventOrdering
  readonly failure: EventFailurePolicy
}
```

Definition 属于发布该 event 的领域协议。`apiVersion` 与 `kind` 标识事件语义；修改 payload、顺序或失败处理的兼容性要求由该协议版本决定。

Observe point 不定义 mutation result。Intercept point 必须定义允许的 decision 形状、合成规则和最终操作结果。

### Event envelope

每次分派产生 envelope：

```ts
interface EventEnvelope<Payload = unknown> {
  readonly apiVersion: string
  readonly kind: string
  readonly id: string
  readonly source: ParticipantIdentity
  readonly sequence?: number
  readonly time?: string
  readonly payload: Payload
}
```

`id` 在发布者规定的事件流内唯一。只有能提供有意义全序的发布者才填写 `sequence`。`time` 是诊断信息，不能替代 sequence 或因果关系。

跨连接发送 event 时，connection/wire 协议负责认证 source、限制大小和去重。进程内 event 不必序列化，但必须遵守相同 payload 语义。

### Observation

Observer 不能修改 envelope 或影响原操作。Dispatcher 可以并发运行 observer，并按 definition 的 failure policy 记录失败。

关键业务路径不能无限等待 observer。Definition 应选择以下一种交付语义：

- `inline`：发布者等待 observer 结束，但 observer 仍不能修改结果；
- `queued`：事件进入有界队列，发布者只等待接纳；
- `best-effort`：允许在过载时丢弃，并记录计数。

需要可靠持久化和消费确认的场景应使用专门的消息或日志协议，而不是把 observe event 扩展为通用消息队列。

### Interception

Interceptor 返回协议定义的 decision，例如 allow、deny 或带字段级 patch 的 replace。可变字段、拒绝原因和多项 decision 的合并方式必须写入 event point definition。

Dispatcher 不把同一个可变对象依次交给 handler。每个 handler 看见该阶段确定的输入并返回独立 decision，随后由确定性 reducer 合并。

Interception 必须具备：

- facet manifest 中的静态订阅声明；
- permission grant；
- 显式且稳定的 order policy；
- 单 handler 和总分派 deadline；
- owner、耗时、decision 和失败的审计记录；
- handler 移除或 scope 关闭时的确定行为。

### Ordering

Event point definition 必须说明 handler 是否互不排序，或者给出可由不同实现复算的顺序规则。具体是有限 phase、显式约束还是其他模型尚未确定。

如果顺序影响结果，注册先后、包安装顺序和异步完成先后不能充当未声明的 order policy。

### Failure and timeout

Definition 明确 failure policy：记录并继续、拒绝当前操作，或使所属协议实例降级。Dispatcher 对未知异常生成稳定 code，并清理 stack、路径和敏感 cause 后再跨信任域传播。

Interceptor timeout 不能静默视为成功。采用 allow-on-timeout 还是 deny-on-timeout 必须由 event point definition 明示，并出现在审计记录中。

### Ownership and cleanup

每项 subscription 记录 activation instance owner，并登记到 lifecycle cleanup scope。Reload 不继承旧 subscription；新实例必须重新注册。

产品 adapter 可以使用自身已有的扩展点实现标准 event point。插件只消费标准 API，不依赖内部机制。Adapter 负责建立 owner 和 disposer；某个产品是否需要 wrapper 或 patch 不属于 events 协议。

## Security considerations

Event payload 只包含该 event point 规定的最小数据。凭据、device code、原始异常和未经筛选的 session 内容不得因“方便观察”而进入通用 envelope。

远端 participant 订阅 event 不等于获得本地 event 流。跨端 export 需要 connection agreement 和 permission grant。

Interception 能改变业务结果，默认权限级别高于 observation。产品可以禁止第三方 component 注册特定 interceptor。

## Drawbacks

每个 intercept point 都需要明确 reducer、顺序和失败策略，设计成本高于任意 `before-*` hook。

旧产品如果没有对应扩展点，adapter 可能无法可靠实现某些 event point。标准化插件可见的 event surface 不会自动产生产品扩展能力。

## Rationale and alternatives

### 所有事件都允许返回修改值

这会让普通日志或 UI observer 获得隐式控制权。Observe 和 intercept 使用不同 contract，调用方可以在安装和授权时区分风险。

### 共享可变 payload

共享对象使结果依赖 handler 顺序，且难以记录每个 handler 的影响。结构化 decision 与 reducer 可以复算并审计。

### 固定一份全局事件列表

领域事件会随协议独立演进。Events 包只定义 event point 机制，具体事件由 session、tool、model 等协议拥有。

## Unresolved questions

### Cross-process observation

是否定义通用 event stream wire contract，还是由每个领域协议选择 subscription/cursor 模型，需要用真实跨端诊断场景验证。

### Ordering vocabulary

需要先用实际 observe 与 intercept 场景比较无序、阶段和约束等方案，再决定是否由 events 定义通用 ordering vocabulary。

### Durable audit schema

Interception audit 与通用 provenance report 的公共字段将在 provenance proposal 中确定。
