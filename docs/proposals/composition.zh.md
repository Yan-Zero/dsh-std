# `@dsh-std/composition` 设计提案

- 文档类型：设计提案
- 状态：探索性草案
- 日期：2026-08-16

## Summary

Component Composition 定义如何把一组静态 manifests 中的 facets、运行时协议声明和显式 policy 输入组合成 activation plan。

它使用领域协议提供的 composition rule 做静态 preflight，并在 activation 产生 staged/live declarations 后调用 core 完成实际协议协商。Composition 不替协议决定领域专属的数量、选择和冲突规则。

## Motivation

一个运行环境可能同时包含内建组件、第三方插件和按连接出现的实现。简单地按注册顺序调用它们会产生不稳定结果：

- 两个组件可能声明相同 id 或互斥版本；
- 某种扩展允许多项，另一种只能有一个实现；
- 有的实现需要由 shell 选择，有的可以自动合并；
- 静态 manifest 声称支持协议，但运行时只启用了其中一部分；
- 非标准 patch 或 override 可能发生冲突，但其检测能力取决于具体 adapter。

Composition 把这些问题变成显式、可复算的计划，而不是插件 loader 的副作用。

## Guide-level explanation

组合器接收：

- 候选 component manifests；
- 当前环境注册的 activation definitions 与 drivers；
- 产品内建参与者的声明；
- 当前实际 protocol supports；
- 用户、profile 或管理员提供的 policy；
- 已注册协议的 composition rules。

输出 `CompositionPlan`。Plan 说明哪些 facets 被选择、每项 requirement 如何满足、哪些 extension 被接纳、有哪些 warning/error，以及每个结果的来源。安装与版本决策仍以 component 为单位，激活与静态能力边界以 facet 为单位。

Plan compatible 后，产品实现再按 lifecycle proposal 执行加载和激活。Composition 本身不导入模块，也不调用插件代码。

## Reference-level explanation

### Inputs

候选集包含静态与运行时两类事实：

- manifest 表示每个 facet 可能需要、支持或贡献什么；
- live declaration 表示当前实例实际支持什么。

内建实现可以没有 manifest，但必须提供可归属的 participant identity 和 live declaration。第三方 participant 的 live support 必须受产生它的 facet 静态声明约束。

### Facet selection

Composition 独立选择 component 中的各个 facets。选择条件至少包括：

- 当前 loader 是否注册了与该 facet 精确兼容的 activation driver；
- facet 的必需 protocol requirements 是否有可形成 agreement 的候选；
- component relationships 是否满足；
- permission policy 是否允许尝试激活；
- 调用方显式提供的部署与产品 policy。

Facet 名称和发现顺序不构成选择条件。Composition 不根据 `web`、`server`、`runtime` 等名称推断运行位置，也不把未知 activation kind 当成可以尝试 import 的模块。

Activation definition 可以在没有 driver 时参与静态校验，但不能使 facet 成为可执行候选。多个 drivers 声明能够激活同一对象时，composition 要求 policy 明确选择，或按该 activation kind 自身规定的确定性规则选择；不得使用注册顺序。

没有 activation 的纯声明 facet 可以直接进入静态 composition，但其 extension 是否需要运行时 handler 仍由所属协议决定。

同一 component 未被选择的 facet 不会把 requirements、extensions 或 permission requests 带入 plan。Component 已安装也不表示其全部 facets 必须激活。

### Protocol preflight and negotiation

Composition 不把 manifest 的潜在 supports 伪装成 live declarations。计划分为两个阶段：

1. preflight 使用 facet 的静态 requirements、support 上限、现有 live declarations 和协议 composition rules，判断候选计划是否有实现可能，并建立 activation 次序或约束；
2. lifecycle 创建 planned participant，激活 facet 并取得 staged supports 后，composition 才把实际 declarations 交给 core evaluator；definition 决定是否兼容以及 agreement 的内容。

Preflight 成功不是协议 agreement。静态候选在运行时没有发布、少发布、校验失败或状态变化时，candidate plan 必须失败、回滚或重新组合。

Composition 不把所有协议统一解释成“一个 consumer 绑定一个 provider”。协议可以自行采用：

- 多项并存；
- 唯一实现；
- 从候选中选择一项；
- 由 shell 或用户选择；
- 合并目录或贡献；
- 仅检查双方功能交集。

这些规则必须由协议 definition 或明确的 policy 表达，不能由注册顺序推断。

### Component relationships

明确指向发行物的关系分为：

- `depends`：目标缺失或版本不符时阻止激活；
- `recommends`：目标缺失或版本不符时产生 warning；
- `breaks`：匹配目标存在时阻止激活；
- `conflicts`：匹配目标存在时产生 warning，是否继续由 policy 决定。

协议 requirement 优先于 component dependency。只有确实依赖某个实现包而不是某份协议时，才使用 component relationship。

### Contributions

被选中 facet 的 manifest extension 由所属协议提供 composition rule。Rule 可以校验：

- extension id 的范围与唯一性；
- 是否允许多个 owner；
- 合并、选择或覆盖语义；
- 与其他 extension 的显式冲突；
- 计划中需要保存的 provenance。

Composition 没有通用“最后注册者覆盖”规则。协议未提供规则且出现无法唯一解释的冲突时，plan 不兼容。

### Plan and provenance

`CompositionPlan` 至少包含：

- 输入 manifests、live declarations 和 policy 的 digest；
- 被选择、跳过和拒绝的 component 与 facet；
- 每个 selected facet 对应的 activation kind、静态声明 digest 和计划实例边界；
- protocol preflight report；
- 对已有 live declarations 可立即形成的 core negotiation report；
- activation 后必须验证的 agreement conditions；
- 每项 extension 的 owner 与 composition 结果；
- component relationships 的检查结果；
- adapter 能够静态识别的非标准影响；
- 稳定 issue code、path 和相关 component ids。

相同规范化输入必须产生等价 plan。Plan 的排序由标识和协议规则确定，不能保留发现顺序作为隐式语义。

### Activation boundary

Composition plan 是执行前决策，不是运行时容器。

Lifecycle implementation 根据 plan 激活 facet。每次实际注册的服务、协议 support、event handler 和 UI contribution 都应记录 activation instance owner，并能在停用时清理。

如果实际激活结果偏离 plan，例如 facet 没有发布已选择的必需 support，lifecycle implementation 必须报告 activation failure，并触发重新组合、降级或回滚策略。它不能悄悄把静态声明当作 live implementation。

## Security considerations

Policy 是 composition 的显式输入。来自 component 的 priority、selector 或 relationship 不得自行扩大权限。

Plan 中的协议 agreement 不等于用户授权。Permission proposal 决定哪些请求需要批准以及 adapter 如何执行 grant。

Adapter 如果能够识别非标准 patch 或 override，应把它作为附加影响报告给调用方。通用 composition 协议不假定所有实现都能静态发现任意代码修改。

## Drawbacks

Composition 需要每个可组合协议定义自己的规则。早期协议如果缺少规则，会更频繁地把歧义报告为错误。

静态计划与运行时实际状态分离后，实现需要处理激活失败和重新组合，不能只执行一次拓扑排序。

## Rationale and alternatives

### 由 loader 顺序解决冲突

加载顺序通常来自文件枚举、依赖安装或异步时序，难以复现，也无法在执行代码前解释结果。Composition plan 使用显式规则和 policy。

### 在 core 中统一 composition mode

固定的 `many`、`single` 或 `selected` 枚举不能完整表达事件合并、目录 ownership、双向连接等协议。Core 只调度 definition；composition rule 由协议拥有。

### 只检查静态 manifest

Manifest 是发行物上限，无法证明当前配置和运行实例已经提供实现。Activation plan 同时保留静态检查与 live declaration 验证。

### 以 component 作为最小激活单位

一个发行物可以同时携带 runtime、TUI、Web 或纯声明部分。整包激活会引入与当前环境无关的 requirements 和副作用。Composition 以 facet 为最小单位，同时保留 component 作为安装和版本关系边界。

## Unresolved questions

### Recomposition

运行中 participant 或 support 变化时，哪些协议允许增量重组、哪些必须重启，由协议规则声明还是由 lifecycle policy 统一限制，尚未确定。

### User selection

需要人工选择实现时，composition 应输出可恢复的 pending plan，还是由调用方先补齐 policy 再重新求值，需要结合 presentation 与非交互环境设计。

### Legacy overrides

是否需要为可声明的 patch/override 建立标准 extension，必须先从多个产品适配器中确认共同字段；当前不定义通用 mutation vocabulary。
