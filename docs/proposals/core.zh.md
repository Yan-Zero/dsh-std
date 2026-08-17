# `@dsh-std/core` 元协议设计提案

- 文档类型：设计提案
- 状态：方向已确认，接口草案
- 日期：2026-08-16

## Summary

`@dsh-std/core` 定义 DSH Standard 的元协议。实现使用它声明自己理解、需要和实现哪些协议，并在共同支持的协议版本之间完成协商。

各领域协议独立发布、独立版本化，也可以被独立实现。实现 `connection` 不要求同时实现 `command`、`tool` 或 `presentation`；一个产品也不必使用 `@dsh-std` 发布的 TypeScript 代码，只要其行为符合所实现协议的文档与互操作要求。

Core 不规定领域对象、调用方法、网络承载、插件生命周期或界面模型。这些内容属于可拔插的协议及其实现。

## Motivation

DSH Standard 包含多份用途不同的规范。Host、TUI、Web、GUI、插件运行时和远端连接程序通常只需要其中一部分，而且它们可能由不同项目、不同语言实现。

仅比较软件包名称无法回答以下问题：

- 两个实现是否理解同一份协议；
- 双方支持的版本能否互操作；
- 某项协议是必需还是可选；
- 协议的可选部分如何选择；
- 协商失败来自未知协议、版本不兼容，还是协议自身的约束。

Core 提供共同的声明外壳和协商入口。领域协议负责解释自身声明，core 负责找到对应的协议解释器并汇总结果。

## Guide-level explanation

### 协议与实现

一份协议由 `apiVersion` 和 `kind` 标识。例如：

```ts
{
  apiVersion: 'connection.dsh/v1alpha1',
  kind: 'ConnectionService',
}
```

协议包可以提供类型、schema、校验器、协商器、codec、状态机或一致性测试。这些代码是规范的可复用部件，不是产品实现。

例如，`@dsh-std/connection` 可以定义应用消费的 `ConnectionService`，并提供 offer 校验、协商算法、codec 和通用状态机。Connection Host 实现监听、认证、承载、调用分派和产品集成；TUI、Web、GUI 与业务插件通过 service facade 使用连接，不分别实现这些基础设施。其他语言的 Host 可以不使用 npm 包而实现同一协议。

### 协议声明

参与协商的一方提交 `ProtocolDeclaration`。声明包含参与者身份，以及它对各协议的需求和支持：

```ts
interface ProtocolDeclaration {
  readonly participant: ParticipantIdentity
  readonly requires?: readonly ProtocolRequirement[]
  readonly supports?: readonly ProtocolSupport[]
}
```

`requires` 表示该参与者希望协商的协议。Requirement 可以是必需或可选。

`supports` 表示该参与者在当前协商范围内实际可用的协议实现。安装了某个包、在静态清单中提到某项协议，或者能够解析其数据，都不能代替运行中的 support 声明。

Requirement 和 support 可以携带由所属协议定义的 `spec`。Core 保留该数据，但不解释其字段：

```ts
interface ProtocolRequirement extends ApiReference {
  readonly optional?: boolean
  readonly spec?: unknown
}

interface ProtocolSupport extends ApiReference {
  readonly spec?: unknown
}
```

协议可以用 `spec` 表达角色、功能子集、限制或协商参数。Core 不预设 client/server、provider/consumer、execution plane 或 locality 等模型。

### 协议解释器

理解一份协议的 evaluator 注册该协议的 `ProtocolDefinition`。Definition 至少负责：

- 识别自己支持的 API version；
- 校验 requirement 与 support 中的协议专属 `spec`；
- 判断一组声明能否共同工作；
- 生成该协议的协商结果和诊断。

注册 definition 只表示 evaluator 理解该协议。参与者是否实现协议，仍以本次声明中的 `supports` 为准。

协议可以只提供声明 schema，也可以附带确定性的参考协商器。`connection` 这类约束较多的协议适合提供参考实现；只有简单版本选择的协议则可以只提供校验和兼容性规则。

### 协商

调用方先确定本次参与协商的声明集合，再交给 core。Core 不自行发现进程、插件或远端设备，也不决定哪些参与者应当被放进同一协商范围。

协商过程为：

1. 校验 core 外壳和参与者身份；
2. 按协议族归集 requirements 与 supports；
3. 为每个协议族选择已注册且能处理相应版本的 definition；
4. 由 definition 校验协议专属数据并产生协议结果；
5. 汇总必需协议错误、可选协议缺失和各协议的 agreement。

Core 不把“找到同名 support”直接等同于协商成功。多实现选择、角色关系、功能交集和参数降级均由相应协议决定。

### 按需实现

每个参与者只声明本次实际理解和支持的协议。例如：

- 一个无界面的后台进程可以提供 ConnectionService 和 AgentControl；
- TUI 可以要求 Connection Service，并实现若干 presentation 协议；
- Web 可以要求相同的 Connection Service，但提供另一组 presentation 协议；
- 只提供工具目录的组件可以实现 tool，而不实现 command。

协商不会把未声明的协议视为缺陷。只有另一参与者将其列为必需 requirement 时，缺失才会使该次协商失败。

## Reference-level explanation

### Protocol identity

```ts
interface ApiReference {
  readonly apiVersion: string
  readonly kind: string
}
```

`apiVersion` 由协议 group 和版本组成，`kind` 标识该 group 中的协议。二者共同确定一份版本化协议。

Core 可以解析版本标识并建立候选集合，但不假定同一 major 下的 alpha、beta 和 stable 必然互通。精确版本之外的兼容关系由该协议的 definition 声明。没有对应 definition 时，evaluator 不能声称已经完成该协议的协商。

Core 不根据 group 名称判断协议是否属于某个标准集合。命名空间归属与保留规则、协议发布状态和目录收录规则由相应治理或分发机制规定，不属于协商算法。只要坐标、definition 和声明满足本协议，evaluator 对它们采用相同的校验与协商过程。

目录收录不是协议可用性的必要条件。实现可以从静态目录、安装包、产品内建模块或显式配置取得 definition；目录也不能仅凭收录条目产生 live support。不同来源提供同一坐标但 definition 内容不一致时，evaluator 必须报告定义冲突，不能以发现顺序选择其一。

### Participant identity

参与者是在一次组合或连接中提交协议声明的实体。它可以对应插件实例、profile、进程、客户端、服务或其他实现单位。

Core 只要求身份在当前协商范围内唯一。身份如何认证、是否跨重启稳定、是否可向对端公开，由建立该协商范围的协议或产品决定。

Manifest facet 不是 participant。Facet 是发行物中的静态声明和激活单位；participant 是 coordinator 为 activation instance 创建、实际参加某次协商的运行实体。组件模型第一版令一个 activation instance 对应一个本地 participant；同一 facet 的多次激活仍会产生不同 participants。产品也可以产生没有 manifest facet 的内建 participant。

Core 不把 component id、facet name 或进程位置规定为 `ParticipantIdentity` 的固定字段。需要归属信息的实现通过 lifecycle/provenance 保存本地关联；向连接对端公开哪些关联由 connection view 和 policy 决定。

### Protocol definition

`ProtocolDefinition` 是 evaluator 对一份领域协议的本地解释。概念接口如下：

```ts
interface ProtocolDefinition<RequirementSpec = unknown, SupportSpec = unknown, Agreement = unknown>
  extends ApiReference {
  validateRequirement(spec: unknown): RequirementSpec
  validateSupport(spec: unknown): SupportSpec
  negotiate(input: ProtocolNegotiationInput<RequirementSpec, SupportSpec>): ProtocolNegotiationResult<Agreement>
}
```

具体 TypeScript API 可以为 schema-only 协议提供默认适配器，但不得改变以下语义：

- 协议专属字段由协议 definition 拥有；
- 协商结果可由其他符合规范的实现独立复算；
- 注册顺序不影响结果；
- definition 不因被注册而产生一项 live implementation。

Evaluator 在解释一项协议专属 `spec` 前必须取得能够处理该坐标的 definition。Definition 的发现和装载先于依赖它的声明校验；装载 definition 所需的包格式、签名、信任和执行策略不属于 core。未知 required requirement 阻止该次协商；未知 optional requirement 作为未满足的可选项报告。未知 support 不得被当作已经理解或可以调用的实现。

### Negotiation result

一次 core 协商产生机器可读报告。报告至少包含：

- 参与协商的声明及其 revision 或 digest；
- 每份已处理协议所选的 API version；
- 各协议 definition 产生的 agreement；
- 缺失的可选 requirement；
- 阻止协商的 issue 及其声明路径；
- evaluator 的身份与版本。

Agreement 是协议拥有的数据。Core 不假定它一定是 RPC binding、资源选择或权限 grant。调用方也不能仅凭 agreement 绕过相应协议和产品实现的授权检查。

### Determinism

同一组规范化声明、同一组 protocol definitions 和同一份显式 policy 输入必须产生等价结果。实现不能使用注册顺序、对象属性顺序或进程本地地址作为隐式选择条件。

协议若需要优先级、用户选择或环境策略，必须在自己的协商输入中明确表达，并把相关选择反映在 agreement 或诊断中。

### Package and wire independence

Core 定义对象语义，不规定对象来自 npm 包、静态清单、进程内注册表还是网络消息。文件名、JSON 编码、签名和安装期检查属于清单与分发提案；跨进程 framing、认证和重放处理属于使用这些声明的连接或 wire 协议。

TypeScript helper 是一种参考实现。与其产生相同规范化声明和协商结果的实现可以使用其他语言与运行时。

## Protocol boundary

Core 包含：

- 协议和参与者的通用标识；
- requirement、support 与 declaration 外壳；
- protocol definition 的注册和查找；
- 协商调度、结果汇总与通用诊断；
- 规范化和确定性检查所需的纯函数。

以下内容由其他协议或产品实现定义：

- 插件包入口、依赖和安装格式；
- resource、command、tool、model、presentation 等领域对象；
- provider 数量、选择规则和调用接口；
- 生命周期、事件、权限和撤销；
- endpoint、连接、传输、认证和 wire frame；
- 运行时 registry、服务容器、handler 和 UI。

## Drawbacks

Core 不能独自判断领域协议是否真正兼容。Evaluator 必须安装相应 definition；跨语言实现也必须复现该协议规定的校验与协商语义。

协议专属 `spec` 对 core 是不透明值，因此通用工具只能展示外壳。需要编辑表单、详细错误或静态分析时，工具必须取得对应协议的 schema 或 definition。

把 provider 选择等规则交还领域协议，会让不同协议采用不同的 composition model。这是允许事件、目录、RPC 和 UI contribution 独立演进所需的代价。

## Rationale and alternatives

### 在 core 中定义统一的 resource 与 capability

统一分类会迫使所有协议采用同一种发布、选择和调用模型。目录、事件、连接与表现操作的组合规则并不相同，因此 core 只提供协议声明外壳；协议可以自行定义 resource 或 capability 概念。

### 仅比较包名和版本

软件包不是互操作边界。同一协议可以由不同包、不同语言或产品内建实现；同一个包也可能因配置只启用部分协议。协商使用协议声明，而不是安装记录。

### 由 core 统一选择 provider

有的协议需要唯一实现，有的允许多个实现，有的只计算功能交集。Core 没有足够信息给出统一选择规则；该规则属于协议 definition。

### 把具体协议的字段加入 core

一旦 core 认识 endpoint、presentation、session 或 transport 字段，新增协议就需要修改元协议。协议专属内容保留在其 `spec` 和 agreement 中，并由对应 definition 校验。

## Implementation boundary

`@dsh-std/core` 的参考实现只保留通用协议标识、声明、definition catalog 与协商分派。早期原型中的 `DshResource`、`ExecutionPlane`、插件关系、`PluginRegistry` 和 `RuntimeSnapshot` 已迁移出 core：

- 静态插件包声明和关系进入 manifest/composition；
- component、facet 与 activation instance 的关联进入 manifest/lifecycle/provenance；
- endpoint 与 live offer 进入 connection 或 inventory；
- resource 外壳由需要它的领域协议共享，而不是由所有协议强制继承；
- activation registry 由 adapter 或独立 composition 实现；
- `locality` 不进入静态 protocol requirement，连接位置由 connection 协议表达。

这些包可以独立实现或替换；core 不反向依赖它们。

## Unresolved questions

### Definition discovery

静态工具和运行时需要按 `apiVersion`、`kind` 找到 schema、协商规则与一致性测试。发现机制可以使用多个目录或分发系统，但必须验证坐标与内容身份，并对同坐标冲突给出确定结果；npm registry 不是协议要求的唯一发现机制。

### Declaration revision

长连接中支持集合发生变化时，是替换完整声明还是传递增量，由使用 core 的协议决定。Core 仍需规定 digest 和等价性计算是否采用统一 canonical form。

### Shared schema vocabulary

协议 definition 是否必须发布某一版本的 JSON Schema，还是允许其他机器可读 schema 并通过 content type 标识，尚未确定。
