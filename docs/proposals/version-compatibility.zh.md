# 协议版本兼容与协商设计提案

- 文档类型：设计提案
- 状态：草案
- 日期：2026-08-23

## 摘要

本提案规定同一 `ProtocolDefinition` 识别多个 `apiVersion` 时的兼容与协商边界。协议 definition 拥有版本之间的兼容关系、选择规则、agreement 和失败语义；`@dsh-std/core` 只按坐标找到 definition、保留声明版本、调用协议专属校验与协商，并汇总结果。

`apiVersion` 是协议版本的唯一权威来源。Requirement 的请求版本来自 `ProtocolRequirement.apiVersion`，support 的实现版本来自 `ProtocolSupport.apiVersion`。协议不得在 `spec` 中复制第二份通用版本号并让其与坐标竞争。

本文中的“必须”“禁止”“应”“不应”和“可以”分别对应 MUST、MUST NOT、SHOULD、SHOULD NOT 和 MAY。

## 范围

本提案规定：

- Core 如何把多个已识别坐标交给同一 definition；
- definition 如何声明和裁定有方向的版本兼容关系；
- requirement、support、optional requirement 与 agreement 的版本语义；
- 版本专属 `spec` 校验所需的上下文；
- 可选的全序最小选择模型；
- 错误、确定性、安全与兼容性要求。

本提案不规定：

- 全生态共享的版本全序或 SemVer 兼容推断；
- npm package version、组件依赖解析或传递依赖图；
- provider 的授权、生命周期、激活顺序或产品 policy；
- 所有协议必须采用的 agreement 结构；
- 偏序、DAG、范围或约束求解的统一算法。

## 术语

**协议坐标（protocol coordinate）**由 `apiVersion + kind` 组成，标识一份版本化协议语义。

**主坐标（primary coordinate）**是 `ProtocolDefinition.apiVersion + kind`。Core 在报告中使用主坐标标识负责本次协商的 definition；它不自动表示最终采用的 contract dialect。

**已识别版本（recognized version）**是 definition 主坐标的 `apiVersion`，或列入 `ProtocolDefinition.accepts` 的 `apiVersion`。`accepts` 只声明同一 definition 能够解析和裁定这些坐标，不声明任意两个版本兼容。

**请求版本（requested version）**是 requirement 自身的 `apiVersion`。

**实现版本（support version）**是 live support 自身的 `apiVersion`。

**contract dialect** 是 agreement 规定参与者实际共同遵循的协议版本语义。

**realize** 表示某项 live support 能够按照 definition 的规则实现某个 contract dialect。`supportVersion` 较新不自动表示它能够 realize 较旧版本。

**兼容关系（compatibility relation）**是 definition 对请求版本、实现版本、双方 `spec` 和显式 policy 作出的有方向裁定。该关系不必是全序、对称关系或传递关系。

## Core 调度语义

### Definition 注册

`ProtocolDefinition.accepts` 可以把多个 `apiVersion` 映射到同一份 definition。每个被接受的版本仍与原 `kind` 组成独立坐标。Core 必须拒绝由不同 definitions 重复注册的相同坐标。

Core 不得从 `apiVersion` 的 group、major、stability、revision 或字符串顺序推断兼容关系。`protocolFamilyKey()` 只提供分组键，不构成互操作声明。

Definition 可以识别不同稳定度、不同 major，或由私有协议规定的离散版本集合。是否允许这些版本互操作完全由该协议的规范决定。

### 版本感知校验

Core 调用 `validateRequirement` 和 `validateSupport` 时，必须同时提供包含原始 `apiVersion + kind` 的 `ProtocolValidationContext`。Definition 必须针对声明的准确版本校验 `spec`，不得先把旧版本静默投影为新版本再按新 schema 接受。

概念接口如下：

```ts
interface ProtocolValidationContext extends ApiReference {}

interface ProtocolDefinition<RequirementSpec, SupportSpec, Agreement, Policy>
  extends ApiReference {
  readonly accepts?: readonly string[]
  validateRequirement(spec: unknown, context: ProtocolValidationContext): RequirementSpec
  validateSupport(spec: unknown, context: ProtocolValidationContext): SupportSpec
  negotiate(
    input: ProtocolNegotiationInput<RequirementSpec, SupportSpec, Policy>,
  ): ProtocolNegotiationOutcome<Agreement>
}
```

校验后的 requirement 和 support 必须保留原始 `apiVersion`。Definition 的 `negotiate()` 接收完整的 requirement/support entries，因此可以按方向解释不同版本。

### 报告边界

Core 的 `NegotiatedProtocol.apiVersion` 是 definition 主坐标，而不是通用的 `selectedVersion`。若一次协商发生跨版本匹配，协议自己的 agreement 必须以机器可判定的形式记录请求版本、实现版本、所选 dialect 以及必要的兼容模式。

Core 不增加通用的 `selectedVersion`、`adapterPath` 或兼容图字段。不同协议可能产生单个 dialect、多个按 scope 区分的 bindings、偏序中的多个极小解，或不包含版本选择的 agreement；这些结构不能由 Core 统一解释。

## Definition 兼容规则

识别多个版本的 definition 必须在相应协议规范中声明：

- 可识别的完整 `apiVersion` 集合；
- 每个版本的 requirement 与 support `spec` 结构；
- 兼容关系的方向和条件；
- 是否允许一个 support realize 多个 dialect；
- 多个 requirements 是否共享一个 dialect，或分别产生 bindings；
- required 与 optional requirements 的处理方式；
- provider 冲突、歧义和显式 policy 的处理方式；
- agreement 中记录版本裁定的格式；
- 稳定 issue code、severity 和失败条件；
- 兼容关系自身的演进规则与 conformance fixtures。

`accepts` 中出现一个版本但协议规范没有为其定义校验与协商语义时，definition 不符合本提案。

### 有方向兼容

兼容关系必须按请求方向判断。例如，Command definition 可以规定：

- `commands.dsh/v1alpha2` support 能够 realize `commands.dsh/v1alpha1` dialect；
- `commands.dsh/v1alpha1` support 不能满足 `commands.dsh/v1alpha2` requirement。

在第一种情况下，agreement 可以选择 `v1alpha1` dialect，并记录由 `v1alpha2` support 实现该 dialect。该结果不表示 requirement 被升级为 `v1alpha2`，也不表示两个版本双向等价。

Definition 不得仅因两个版本共享 major、后缀可排序或来自同一 npm package 而接受跨版本匹配。对称性和传递性也只能由协议明确声明。

### Requirement 与 support

Requirement 的 `apiVersion` 声明消费者需要的 contract 语义。Support 的 `apiVersion` 声明现场实现原生提供的版本语义。安装 definition、能够解析某个版本或 package 依赖中出现某个版本都不构成 live support。

`spec` 可以描述 feature、scope、限制条件或由协议定义的 realization 证据，但不得覆盖声明对象自身的 `apiVersion`。发现坐标与 `spec` 内协议专属约束矛盾时，definition 必须拒绝该声明。

### Optional requirement

Optional requirement 必须保持非阻断语义。它可以形成成功 binding、warning 或协议定义的 degraded 结果，但不得仅因自身没有兼容 support 而产生使整个 Core report 不兼容的 error。

若协议需要从多个 requirements 选择一个公共 dialect，optional requirement 不得提高 required requirements 决定的最低强制 dialect。协议可以在不改变 required 结果的前提下报告 optional requirement 是否同时满足，但必须保持该裁定可复算。

当全部 requirements 都是 optional 时，definition 可以不产生 agreement，或产生只包含已满足 optional bindings 的 agreement；选择必须由协议规范固定，不能依赖注册顺序。

## 协商规则

Definition 必须按以下顺序完成跨版本协商：

1. 按每条声明的准确 `apiVersion` 校验 requirement/support `spec`；
2. 使用协议规定的稳定顺序规范化 requirements、supports 和显式 policy；
3. 分别处理 required 与 optional requirements；
4. 根据有方向兼容关系计算每条 requirement 的 eligible supports；
5. 对 required requirement 缺少 eligible support 的情况产生 error；
6. 对 optional requirement 缺少 eligible support 的情况产生 warning 或协议规定的非阻断结果；
7. 按协议规则处理 provider 歧义、公共 dialect 或多个独立 bindings；
8. 产生足以复算版本裁定的 agreement 和 issues。

同一组规范化 declarations、同一 definition 和同一显式 policy 必须产生等价结果。Definition 禁止以声明遍历顺序、support 注册顺序、对象属性顺序或进程本地状态作为隐式裁决条件。

## 可选的全序最小选择模型

协议只有在明确满足以下全部条件时，才可以采用 max-of-minimums：

1. 本次协商涉及的有限 `apiVersion` 集合存在协议规定的确定性全序；
2. requirement 的版本具有 minimum 语义，即较低 requirement 能接受协议规定的较高兼容 dialect；
3. support realization 单调向下闭合，即较高 support 能 realize 协议明确列出的全部较低 dialect；
4. 全部 required requirements 必须共享一个 contract dialect；
5. 不存在 maximum、exact pin、互斥、偏好或条件排除。

算法只使用 required requirements 的 `apiVersion`，并选择其中最大者作为 `selectedDialect`。随后筛选能够 realize `selectedDialect` 的 live supports；没有 eligible support 时协商失败。Optional requirements 不参与最大值计算，也不得把结果隐式提高到 required 最大值之上。

采用该模型的协议必须在自身规范中固定版本全序、realization 规则、重复声明规范化、provider policy、agreement 结构和 issue codes。未知版本、非全序输入或非单调 realization 必须 fail closed。

缺少任一前提时，definition 必须使用协议专属的 pairwise、区间、偏序、DAG 或约束协商算法，不得声称采用 max-of-minimums。

## 错误

Core 继续使用通用的 `definition-unavailable`、`invalid-requirement`、`invalid-support` 和 `definition-failed` 等诊断。版本兼容失败由协议 definition 使用自己的稳定 issue code 报告。

完整协商结果至少必须区分：

- 声明版本未被 definition 识别；
- `spec` 对该准确版本无效；
- requirement 与现场 supports 版本不兼容；
- required support 缺失；
- provider 或 dialect 选择存在歧义；
- optional requirement 未满足。

错误不得只返回无法机器分类的 message。发生跨版本匹配时，agreement 或诊断必须保留参与裁定的原始版本。

## 生命周期与演进

兼容关系是协议 contract 的一部分。改变版本顺序、方向兼容、realization 条件、selection policy 或失败语义，若会改变既有输入的 agreement 或错误结果，就必须按照该协议的兼容规则发布变更。

已经发布的 `apiVersion` 不得被原地改写为不兼容语义。协议可以发布新坐标，并由同一 definition 在迁移期同时识别新旧坐标；是否兼容仍须显式规定。

npm package version 与协议 `apiVersion` 是独立版本轴。更新 definition 的实现包不得因此改变既有协议坐标的含义。

## 安全考虑

- 未知版本和未声明的兼容边必须 fail closed，不能按字符串大小猜测；
- support 声明不是身份、授权、artifact provenance 或行为安全证明；
- evaluator 必须限制 declarations、兼容候选和 policy 输入规模，避免无界排序或图遍历；
- 降低 requirement、替换 definition 或改变兼容表必须出现在 agreement、诊断或 evidence 中，不能静默降级；
- 跨版本 adapter 必须遵守所选 dialect 的全部安全约束，不能因本地实现版本较新而绕过旧 dialect 的限制。

## 兼容性

只识别主坐标并执行精确版本协商的既有 definitions 不受影响。为校验函数增加 `ProtocolValidationContext` 是向后兼容的调用扩展：现有只接收 `spec` 的 TypeScript 函数仍可作为 validator；新 definition 可以读取第二个参数进行版本专属校验。

把版本加入 `accepts` 是可观察的 definition 能力变更，但不自动建立任何兼容边。协议只有在规范、validator、协商器、agreement、fixtures 和方向性测试一致时，才能声称支持跨版本协商。

## 设计选择

### 不在 Core 中规定全局版本全序

线性版本、分叉版本、feature-set 包含关系和私有 DAG 都是有效的协议演进模型。Core 的统一全序会把版本号大小误当作真实兼容性。

### 不把 MVS 作为通用协商规则

Go Modules 的 MVS 解决构建期模块图问题；DSH 处理 live participants 的协议语义。max-of-minimums 只在全序、单调兼容和单 dialect 前提成立时可作为局部算法。

### 不把版本选择字段加入通用 report

Core 已经提供 definition-owned agreement。统一的 `selectedVersion` 无法表达多个 scope bindings、偏序解或没有版本选择的协议，还会让 Core 开始解释领域语义。

### 不由 Core 规定 adapter 实现路径

协议可以在 agreement 中记录可观察的 compatibility mode，但产品内部使用哪个 adapter、转换函数或模块路径不是元协议事实。

## 参考资料

- Russ Cox, *Minimal Version Selection*: https://research.swtch.com/vgo-mvs
