# `@dsh-std/session` 设计提案

- 文档类型：设计提案
- 状态：草案
- 日期：2026-08-17

## Summary

`@dsh-std/session` 定义具名 `SessionEvent` resource。Resource 描述组件拥有的持久会话事件类型，以及读取器在缺少该类型定义时采用的重放规则。

本提案不定义会话管理、事件写入或实时事件分派协议。

## Motivation

会话日志可以包含组件定义的事件。读取器需要知道事件名称及其重放重要性，才能判断未知事件应当阻止恢复还是可以跳过。

若事件类型只存在于实现代码中，安装器无法检查名称冲突，Runtime 也无法在组件激活前建立可用的事件 vocabulary。`SessionEvent` 将这部分信息放入静态 manifest，并保留 component、facet 和 activation instance 的归属。

## Guide-level explanation

Facet 在自身 `extensions` 中声明一种事件类型：

```ts
{
  apiVersion: 'session.dsh/v1alpha1',
  kind: 'SessionEvent',
  metadata: { name: 'web/openai-codex-search-llm-request' },
  spec: {
    description: 'Resolved request used by the OpenAI Codex search provider.',
    replay: 'required',
    payloadSchema: { type: 'object' },
  },
}
```

`metadata.name` 同时是持久 event envelope 中的 type。Runtime 根据 selected facets 的 SessionEvent resources 建立当前能够解释的事件 vocabulary。

## Reference-level explanation

### SessionEvent spec

```ts
interface SessionEventSpec {
  readonly description: string
  readonly replay: 'required' | 'ignorable'
  readonly payloadSchema?: Readonly<Record<string, unknown>>
}
```

`description` 说明事件语义。`payloadSchema` 描述 event data；它是不可执行的 schema 数据，不包含 validator 或 callback。

`v1alpha1` 尚未固定 JSON Schema dialect。实现可以用 `payloadSchema` 建立目录或执行自身校验，但不能据此假定不同 validator 的行为完全一致。

### Replay

`replay` 表示读取器无法识别该事件类型时是否仍能正确恢复会话：

- `required`：事件可能影响状态重建；未知该类型时，读取器拒绝恢复；
- `ignorable`：事件不影响状态重建；event envelope 标记为可跳过后，读取器可以忽略其语义。

Resource 中的 `replay` 与持久 event envelope 承担不同作用。Resource 告诉 writer 和目录该类型应采用哪种规则；envelope 中的标记让缺少 Resource 的读取器仍能识别 ignorable event。Runtime 不能只凭当前 vocabulary 将未知事件推断为 ignorable。

### Identity and composition

事件类型 identity 由 `apiVersion`、`kind` 和 `metadata.name` 组成。同一 composition scope 中，同名 SessionEvent 只有一个 owner。不同 owner 对相同名称给出相同 spec，仍构成冲突。

Facet 未被选择时，其 SessionEvent 不进入当前 vocabulary。Facet 激活后，resource 归属于对应 activation instance；停用该 instance 会移除其 live contribution。产品内建事件可以作为内建 contribution 参与同一冲突检查。

### Protocol implementation

SessionEvent 是 resource，不要求 facet 发布运行时 handler。产品实现把 selected resource 映射到自身的事件类型目录、持久化校验和恢复检查。

写入事件的 API 由会话 Runtime 所有。Writer 使用 SessionEvent resource 决定 event type 和 replay 标记，但普通的 SessionEvent declaration 本身不授予写入任意会话的能力。

实时观察、订阅和拦截属于 `@dsh-std/events`。持久 SessionEvent 不定义 handler 顺序、分派 timeout 或 interception result。

## Drawbacks

只有 Resource 的实现不能让远端客户端读取或写入会话。会话目录、历史流和恢复操作需要独立 capability。

`payloadSchema` 未固定 dialect，暂时只能提供有限的跨实现验证一致性。

Required event 会使历史会话依赖相应组件定义。组件若希望记录不影响重放的诊断信息，应使用 ignorable event，并确保写入格式保留该标记。

## Rationale and alternatives

### 使用 `@dsh-std/events` 表示持久记录

Event point 处理运行时分派，SessionEvent 处理持久化与重放。两者的 identity、冲突和兼容性规则不同，因此分别定义。

### 只在 Runtime 中维护事件名称集合

运行时集合无法供安装器和 composition 检查，也没有 component owner。静态 Resource 使事件类型可以在加载实现前验证。

### 相同 spec 的声明自动合并

相同字段不表示两个组件对事件语义具有共同所有权。单一 owner 使版本升级、停用和兼容性诊断保持明确。

## Unresolved questions

### Schema dialect

`payloadSchema` 采用哪一版 JSON Schema，以及未知关键字如何处理，尚未决定。

### Session access

会话目录、历史读取、增量 event stream、cursor 和恢复是否组成一份协议，还是拆分为多个 capability，需要结合远端控制场景继续设计。
