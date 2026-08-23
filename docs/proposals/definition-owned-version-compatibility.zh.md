# 定义自决的版本兼容与协商模型（Definition-owned Version Compatibility）

- 文档类型：设计笔记（**探索性草案，非规范性**）
- 状态：探索性草案
- 日期：2026-08-21
- 相关理论：Russ Cox, *Minimal Version Selection*（仅作为可选算法的理论来源，https://research.swtch.com/vgo-mvs）

## Summary

本提案记录 DSH 生态的**版本兼容与协商模型**：版本之间的兼容关系由各协议 definition 自决，`@dsh-std/core` 不预设版本全序、不推断兼容性、不提供默认选择模型。

本文定位为**设计笔记 / 探索性备忘（Design Notes）**：先记录问题、边界与候选方向，现阶段不提供可直接复用的规范接口。内容分三部分：

1. **协议自决模型**：版本拓扑（全序 / 偏序 / 兼容图）由 definition 拥有，core 只负责把 requirement 与 support 的原始声明交回 definition 调度；
2. **Core 侧待补的接缝**：让跨版本协商真正可落地的 4 个接口方向（兼容方向性声明、带 `apiVersion` 的校验上下文、结构化协商报告、方向性测试夹具）；
3. **可选参考算法**：max-of-minimums（MVS 的运行时投影）仅在 definition 显式声明"全序 + 单调兼容"时作为局部算法可用，不上升为通用协商规则。

本提案**不向 core 增加任何 MUST 语义**，也不要求任何协议采用任何选择模型。实现可以完全不采用本文的任何内容，自主实现自己的协商与选择逻辑。

## 背景与问题

### 版本演进形态多样

DSH 生态中，领域协议、实验协议与私有协议的版本演进远不止一种形态：

- **线性全序**：`alpha1 < alpha2 < beta1 < v1`；
- **分支 / 分叉版本**：两个后续版本各自扩展，互不兼容；
- **Feature-set 集合**：能力集存在局部包含关系，整体无法线性排序；
- **自定义偏序图**：复杂的 DAG 兼容关系。

### 版本号大小 ≠ 真实兼容关系

Go Modules 为了支撑 MVS，定义了严格无歧义的 canonical SemVer 与 pseudo-version；即便如此，也必须引入 Major Version Import Path（v2+ 路径变更）、`exclude`、`retract`、`+incompatible` 等机制来处理"版本号更高但实际并不兼容"的现实。

这直接说明：**版本号的线性大小并不等价于真实的兼容关系**。由 core 为全生态强制规定一套全局共享的版本全序并不合适——它会把所有公共 / 私有协议强行框进单一的线性版本假设中。

## 协议自决模型（Definition-owned）

### Core 现有机制已承载"协议自决"

当前 `@dsh-std/core` 已为此奠定底层机制：

- `ProtocolDefinition.accepts`：允许把多个 `apiVersion` 映射到同一份 definition 实例；core 明确不做兼容推断（"No compatibility is inferred by core."）；
- **原始声明版本保留**：core 完整保留 requirement / support 的原始声明版本，并将它们原样交由该 definition 的 `negotiate()` 统一调度；
- **版本拓扑由 definition 自决**：精确版本匹配（各版本互不兼容）、单向兼容（如 `commands.dsh/v1alpha2` 满足 `v1alpha1`，反之不成立）、等价别名 / 多版本双向兼容、私有 DAG 兼容图或偏序关系，均可由 definition 声明与实现。

因此：Core **既不需要建立全局强制全序，也不需要把 max-of-minimums 作为默认行为**。

### Definition 的职责

采纳本模型的 definition 拥有：

- 支持的版本集合与规范化规则；
- 版本间的序关系（全序 vs 偏序）与真实兼容映射；
- 对应的协商 / 仲裁算法与失败语义；
- 协商结果的记录格式（agreement 内容由 definition 定义，可含所选兼容版本与适配路径）。

## 跨版本协商的待补接缝（Core 侧未来方向）

从当前代码实现与规范落地来看，跨版本协商真正需要补齐的是以下 4 个接口方向。它们属于 core 规范 / 实现的**未来工作，不随本文档落地**；本文只记录方向，供后续规范提案承接。

1. **兼容方向性声明**：`accepts` 目前仅表达 definition 能识别哪些版本，缺少机器可读的单向 / 双向兼容拓扑描述；
2. **带版本的校验上下文**：`validateRequirement` / `validateSupport` 目前未接收声明的 `apiVersion`，不便于针对不同历史版本的 schema 差异化校验；
3. **结构化协商报告扩展**：`NegotiationReport` 缺少统一记录 `selectedVersion`、`requestedVersion` 以及兼容适配路径（`adapterPath` / `compatibilityMode`）的标准化字段；
4. **方向性测试用例**：缺少类似"新版 support 满足旧版 requirement，但旧版 support 拒绝新版 requirement"的有向兼容测试夹具。

## 可选参考算法：max-of-minimums

### 定位与前提

max-of-minimums 是本文记录的一类**可选参考算法**（理论来源：Russ Cox 的 Minimal Version Selection）。它只在 definition **显式声明**以下前提时，才能作为该协议族内部的局部算法使用，**不上升为通用的协议协商模型**：

1. definition 对本次输入涉及的有限版本集合声明可确定复算的**全序**；
2. 兼容关系**单调**：实现较新版本 dialect 的 live support 可以明确声明自己能够实现哪些较旧 contract dialect；
3. requirement 只表达**最低** contract dialect，不表达上限、互斥、偏好或精确 pin；
4. definition 能从 core 提供的 requirements / supports 中提取本文定义的规范化输入。

缺少任一前提（如任意 pairwise 兼容、非全序版本、条件排除、偏好求解或依赖图解析）时，definition 必须使用自己的协商模型，**不得**声称采用本算法。

### Terminology

- **协议族（protocol family）**：由采纳协议定义、共享一套版本选择语义的坐标集合。
- **contract dialect**：参与方在 agreement 中共同使用的协议版本语义。
- **minimum requirement**：消费者能够接受的最低 contract dialect。
- **live support**：参与者在当前协商范围内通过 `supports` 声明的实际可用实现。安装 definition 或能够解析数据不构成 live support。
- **realize**：某个 live support 按 definition 声明的兼容关系实现所选 contract dialect。
- **eligible support**：能够 realize 所选 contract dialect 的 live support。

### 采纳声明

采纳本算法的 definition 必须（MUST）在自身规范中声明：

- 算法标识与版本；
- 协议族身份以及可识别的 API versions；
- 确定性的版本全序与规范化规则；
- `ProtocolRequirement.spec` 如何映射为 minimum requirement；
- `ProtocolSupport.spec` 如何声明 support version 与可实现的 contract dialect；
- 如何验证每个 support 的 `realizes` 集合包含 `supportVersion`、不包含高于 `supportVersion` 的 dialect，并相对版本全序向下闭合；
- 同一 participant 重复声明 requirement 或 support 时如何确定性规范化；
- 稳定 issue code 如何映射到该协议的诊断；
- agreement 中如何记录 selected dialect 与 eligible supports。

缺少上述任一声明时，evaluator 不得（MUST NOT）声称已经按本算法完成选择。

### 规范化输入

算法输入是 definition 对 core 输入的**规范化投影**，不是新的 core 类型：

```ts
interface VersionSelectionInput {
  readonly family: string
  readonly requirements: readonly {
    readonly participant: string
    readonly minimum: string
  }[]
  readonly supports: readonly {
    readonly participant: string
    readonly supportVersion: string
    readonly realizes: readonly string[]
  }[]
}
```

`realizes` 可以由 definition 根据单调兼容规则计算，但计算规则必须是协议规范的一部分，不能依赖本地注册顺序或隐式环境状态。

### 选择过程

1. **规范化**：校验全部 version 都属于声明的协议族并能进入全序；重复声明按协议定义的稳定规则合并。未知或不可排序版本产生 `version-order-undefined`。每个 support 的 `realizes` 必须包含其 `supportVersion`，不得包含高于 `supportVersion` 的 dialect，并且必须相对全序向下闭合；违反任一条件产生 `version-compatibility-non-monotonic`。
2. **判断适用性**：没有 minimum requirement 时返回不含 agreement 的 `not-applicable` 状态。这不表示 supports 无效；definition 仍可按自身语义处理 provider-only discovery，但不得伪造一个版本选择结果。
3. **选择 contract dialect**：取所有 minimum requirements 中的最大值，作为 `selectedDialect`。这是满足全部最低要求的最旧 dialect。
4. **验证可实现性**：从 live supports 中筛选能够 realize `selectedDialect` 的记录。集合为空时产生 `version-support-unavailable`，不得产生成功 agreement。
5. **产生结果**：agreement 记录 `selectedDialect`、规范化 minima、eligible support participants 以及算法版本。选择具体 provider 不属于本算法；需要唯一 provider 的协议必须通过自身显式 policy 决定，并遵守 core 的确定性要求。

算法**不得**主动把 `selectedDialect` 提高到所有 minimum requirements 之上。较新 implementation 可以在兼容关系明确时 realize 较旧 dialect；这不等于协商结果被隐式升级。

### 结果与 issue 语义

参考结果形状如下：

```ts
interface VersionSelectionAgreement {
  readonly algorithm: 'version-selection.dsh/reference/v1alpha1'
  readonly family: string
  readonly selectedDialect: string
  readonly minima: readonly {
    readonly participant: string
    readonly minimum: string
  }[]
  readonly eligibleSupports: readonly {
    readonly participant: string
    readonly supportVersion: string
  }[]
}
```

`minima` 与 `eligibleSupports` 必须使用 definition 声明的稳定顺序输出，保留 participant 与声明之间的对应关系；仅输出去重后的版本字符串不足以复算输入，也不得用对象属性顺序代替显式排序。

采纳协议可以扩展 agreement，但不得改变以下 issue 语义：

| Issue code | Severity | 含义 |
| --- | --- | --- |
| `version-order-undefined` | error | 输入版本不属于 definition 声明的全序 |
| `version-compatibility-non-monotonic` | error | support 的可实现版本集合违反单调兼容前提 |
| `version-support-unavailable` | error | 没有 live support 能实现所选 dialect |

### 示例

**多个最低要求**：参与方要求 `v1` 与 `v2`，一个 live support 实现 `v3` 并声明可 realize `v1`、`v2`、`v3`。结果选择 `v2` contract dialect，该 support 是 eligible；结果不是 `v3`。

**无可用 support**：参与方最低要求为 `v2`，现场只有一个只能 realize `v1` 的 live support。算法必须返回 `version-support-unavailable`，不能仅因 definition 理解 `v2` 而产生 agreement。

**非单调兼容**：若 `v3` 只与 `v1` 兼容而不与 `v2` 兼容，则该协议族不满足本算法的单调前提。Definition 必须使用自己的 pairwise 协商模型，不能声称采用本算法。

### Requirement changes

提高某个 minimum requirement 后，definition 使用完整规范化输入重新计算；不得在旧 agreement 上就地修补。降低 minimum 只表示消费者降低最低要求，不表示精确要求使用较低版本，也不构成上限。需要 exact pin、maximum 或 preference 的协议不适用本算法。

### Compatibility and evolution

算法版本是采纳协议 contract 的一部分。改变全序、兼容关系、规范化规则或失败语义可能改变 agreement，采纳协议必须按自身版本规则处理兼容影响。新算法可以与本算法并存；core 不为任何算法赋予优先级。

### 不移植的 MVS 机制

- 不解析 component / package 版本或传递依赖图；
- 不移植 MVS 的 build list、reverse postorder、exclude、replace 或循环模块图算法；
- 不定义 composition 的 depends / recommends / breaks / conflicts；
- 不选择 provider，不定义授权、生命周期或激活顺序。

### Determinism and conformance

同一组规范化 requirements、live supports、protocol definition 和显式 policy 必须产生等价结果。Conformance 至少覆盖：

- 输入顺序和 support 注册顺序变化不改变结果；
- 多 minimum requirements 选择 max-of-minimums；
- 较新实现能够 realize 较旧 dialect；
- `supportVersion` 缺失于 `realizes`、`realizes` 包含更高 dialect 或不是向下闭合时被拒绝；
- 缺少 eligible support 时 fail closed；
- 未知版本与非单调兼容声明被拒绝；
- provider-only 输入不产生虚构的 selected dialect。

### Security considerations

- support 声明不是安全证明。身份认证、artifact provenance 与授权由承载该声明的协议或产品处理。
- evaluator 必须限制 requirements、supports 和 `realizes` 集合大小，避免恶意声明导致无界内存或排序开销。
- definition 不得把未知版本按字符串偶然顺序纳入全序，否则攻击者可能利用命名制造升级或降级。
- 降低 minimum requirement、改变兼容表或替换 definition 都属于显式输入变化，应出现在 agreement、诊断或 evidence 中，不得静默发生。

## 与 core 的边界（非目标）

- 本文**不是** core 的规范扩展；core 不因本文获得任何新的 MUST 语义；
- core 不解释 requirement 的 spec（core.zh.md："Core 保留该数据，但不解释其字段"）；选择语义由采纳它的 definition 解释；
- 本文不改变任何已有坐标、schema、状态机或协商流程；
- 本文定位为设计笔记，可为未来更合适的模型取代。

## Rationale

max-of-minimums 为本模型提供了一个经过工程验证的起点，但 Go 模块的构建期依赖图与 DSH 的运行时 participant 协商不是同一问题。本文只保留全序、单调兼容与最小满足解三项可映射性质，并显式加入 live support 可实现性检查；其余 MVS 机制（build list、exclude / replace、循环模块图）一律不移植。

Core 没有足够信息统一选择版本或 provider，因此采纳决定、输入映射与 conformance 均属于各协议 definition——这正是"定义自决"模型与 core 元协议定位一致的原因。

## Alternatives

- **协议自行定义 pairwise 协商**：适合非单调兼容或离散版本集合。
- **区间 / 范围协商**：适合需要 minimum 与 maximum 的协议。
- **SAT / 约束求解**：适合互斥、偏好或条件关系；复杂度和诊断模型必须由协议明确承担。

## Unresolved questions

- 4 个待补接缝是否以及如何进入 core 规范（哪个版本、什么接口形状）；
- 是否需要把规范化输入与 agreement 形状发布为独立、版本化的可复用 schema；
- 是否需要一个不进入 core 的参考实现包。

## References

- Russ Cox, *Minimal Version Selection*, https://research.swtch.com/vgo-mvs 。本文只引用其 max-of-minimums 作为可选算法的理论来源，不移植 Go 模块图机制。
