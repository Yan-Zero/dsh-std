# `@dsh-std/lifecycle` 设计提案

- 文档类型：设计提案
- 状态：探索性草案
- 日期：2026-08-16

## Summary

`@dsh-std/lifecycle` 定义 facet activation instance 从计划激活到完全停止的状态、回调和清理语义。它使 loader、插件 SDK 与诊断工具对“已经加载”“可以提供协议”“正在停止”等状态采用一致含义。

Lifecycle 是可选协议。没有插件加载需求的程序可以只实现 core 或 connection，不必实现它。

## Motivation

仅有静态 manifest 无法说明组件是否已成功运行。不同 loader 若自行定义激活顺序，常会出现以下问题：

- 模块已经 import，但依赖协议尚未可用；
- 部分服务注册成功后激活失败，没有统一回滚；
- 热重载时旧 handler、event listener 或 patch 留在运行时；
- “host ready”与“plugin active”互相等待；
- UI 只能看到笼统错误，无法判断失败阶段和 owner。

Lifecycle 为组件实例提供有限状态机。领域事件和产品启动阶段不混入该状态机。

## Guide-level explanation

Composition 先产生可执行的 activation plan。Lifecycle coordinator 按 plan 为每个选中的 facet 创建 activation instance，并向实现提供受控的 activation context。

实现代码在 `activate` 中注册协议 support、服务、event handler 或 contribution。所有注册都绑定到当前 activation instance 的 cleanup scope。`activate` 成功并越过 publication barrier 后，该 instance 才进入 `active`。

停止、重载或激活失败时，coordinator 关闭 scope。通过 scope 注册的资源按规定顺序撤销；组件可以在 `deactivate` 中结束自行管理的工作。

产品是否在所有必需 facets active 后宣布“应用 ready”，属于产品启动策略。Lifecycle 不定义会造成循环依赖的全局 `host:ready -> plugin:activate` 顺序。

## Reference-level explanation

### Activation instance

同一 component 的不同 facets 可以分别激活；同一 facet 也可以产生多个运行实例。Activation instance identity 至少包含 component id、发行版本、facet name 和当前 coordinator 范围内唯一的 instance id。

Activation instance 是 lifecycle、cleanup、permission principal 和本地 provenance 的 owner。第一版组件模型为每个 activation instance 分配一个本地 component participant identity；纯 extension facet 可以不把空 declaration 交给 core。产品内建 participant 不要求来自 activation instance。

Lifecycle state 为：

```text
planned -> activating -> active -> deactivating -> inactive
                |           |            |
                +-----------+------------+-> failed
```

- `planned`：composition plan 已接纳该 facet，尚未执行代码；
- `activating`：facet 的 activation 已交给 loader，activation scope 已创建；
- `active`：激活回调完成，所声明的必需运行时事实已经验证；
- `deactivating`：不再接纳新的组件工作，正在取消任务并清理资源；
- `inactive`：清理完成；
- `failed`：激活或清理没有按协议完成，并附带失败阶段。

发行物下载、解压和静态 manifest 校验发生在 `planned` 之前，不属于 activation instance 的运行状态。纯声明 facet 不执行 module；coordinator 仍为其 composition ownership 建立记录，但可以不创建可执行 activation instance。

### Activation

概念回调为：

```ts
interface LifecycleModule {
  activate(context: ActivationContext): void | Promise<void>
  deactivate?(reason: DeactivationReason): void | Promise<void>
}
```

上述回调由匹配 manifest activation kind 的 driver 取得并调用。Lifecycle 不自行 import 路径，也不根据 facet 名称猜测 loader。Driver 负责把 activation kind 的执行模型适配到共同状态机，但 instance identity、scope、publication barrier 和最终状态由 coordinator 掌握。

`ActivationContext` 至少提供：

- 当前 component、facet 与 activation instance identity；
- composition plan 中授予该 instance 的只读视图；
- 已协商协议的 scoped API；
- cleanup scope；
- activation abort signal；
- 结构化诊断接口。

Context 不暴露未在 manifest 声明、未在 plan 接纳或未获 permission grant 的产品 API。

Facet 的必需 requirements 若已能由现有 live supports 满足，coordinator 在调用 `activate` 前为 planned participant 形成相应 agreement，并把 scoped API 放入 context。依赖同一未发布 activation batch 的协议不能假装已经 live；需要循环或共同 staging 的情形必须由 composition rule 和 atomic activation 机制显式处理。

### Publication barrier

实现代码在 activation scope 中登记实现，但 coordinator 在 `activate` 成功并完成 plan 验证前不把它们作为稳定 live support 发布。

实现可以采用 staging registry，也可以在产品 registry 中登记为不可见状态。关键语义是其他组件不能在 activation 尚可能回滚时把临时 handler 当作已激活协议实现。

当多个 facets 必须作为一个原子批次激活时，coordinator 在全部 activation 成功后统一越过 publication barrier。批次划分来自 composition plan，不按异步完成先后决定。

### Cleanup scope

Activation context 提供统一的 cleanup 注册：

```ts
interface CleanupScope {
  readonly signal: AbortSignal
  add(dispose: () => void | Promise<void>): void
}
```

Scope 关闭时先触发 abort signal，再按注册的逆序执行 disposer。每个 disposer 至多调用一次；某项清理失败不能阻止其余 disposer 运行。

SDK 提供的 service、event、protocol support、timer 与 background task API 都必须自动登记 disposer。实现代码自行创建、无法由 SDK 观察的资源由 `deactivate` 负责。

### Deactivation

停止过程为：

1. 将 instance 标为 `deactivating`，停止接纳新的 scoped 工作；
2. abort activation scope；
3. 等待或取消已登记的后台任务；
4. 调用 `deactivate`；
5. 执行剩余 disposer；
6. 验证已发布 support 和 owner records 均已移除；
7. 进入 `inactive` 或 `failed`。

Coordinator 为各阶段设置显式 deadline。超过 deadline 后可以继续隔离和移除注册项，但必须留下 timeout 诊断，不能把实例报告为正常停止。

### Reload

Reload 创建新 instance，不复用旧 activation scope。默认流程是先为新版本计算 composition plan，再停止旧 instance、激活新 instance并发布新 support。

需要无缝切换的协议可以定义双实例交接规则。Lifecycle 本身不允许把旧 handler 隐式转移给新 instance。

### Diagnostics

状态变化记录 component、instance、from/to state、原因、时间和 plan revision。失败记录稳定 code、阶段和安全处理后的错误信息。

Lifecycle record 是运行时 provenance 的输入。它不应把 activation context、凭据或未经处理的异常对象持久化。

## Relationship to events

Lifecycle callback 是 coordinator 与 activation instance 之间的控制接口，不是通用 event bus。

产品可以通过 `@dsh-std/events` 发布只读 lifecycle observation，使诊断界面获知状态变化。Observer 不能通过监听事件改变状态机。需要阻断激活的 policy 必须在 composition 或 permission 阶段作出决定，而不是注册任意 `beforeActivate` handler。

## Security considerations

Activation context 由 coordinator 创建，实现代码不能自行构造或扩大其 scope。关闭 scope 会撤销由 SDK 签发的 scoped API。

Deactivation deadline 不能保证终止不受控制的本地代码。需要强隔离的实现必须使用 worker、子进程或其他 sandbox，并在超时后终止该隔离单元。

## Drawbacks

Publication barrier 和统一 cleanup scope 要求 loader 与产品 registry 配合。仅包裹一个现有 `activate()` 函数无法提供完整原子性。

严格区分 lifecycle 与 events 会减少任意 hook 的便利性，但能避免 observer 偶然改变激活结果。

## Rationale and alternatives

### 用一组启动事件代替状态机

事件无法证明某个阶段已经完成，也难以定义失败后的回滚。状态机提供权威实例状态；事件只能观察状态变化。

### 把 `ready` 设为固定 component 状态

不同协议的就绪条件不同。组件成功发布所承诺的 live support 后即为 `active`；模型登录、连接建立或索引完成等动态状态由相应协议表达。

### 依赖模块卸载完成清理

JavaScript module 通常不能真正卸载。Cleanup scope 以 owner 为单位撤销其注册和任务，不依赖 module cache 行为。

## Unresolved questions

### Atomic activation batches

Composition rule 如何表达必须共同越过 publication barrier 的 facet 集合，需要在处理循环协议依赖时进一步设计。

### State persistence

进程崩溃后的实例记录是否进入统一 provenance store，以及下次启动如何标记未完成的 deactivation，留给 provenance proposal。

### Default deadlines

标准是否规定默认 activation/deactivation deadline，还是只规定实现必须公开其取值，尚未决定。
