# `@dsh-std/manifest` 设计提案

- 文档类型：设计提案
- 状态：方向已确认，格式草案
- 日期：2026-08-16

## Summary

`@dsh-std/manifest` 定义安装前可读取的 `manifest.yaml`。Manifest 描述一个 component 发行物及其 facets。Component 是安装、版本和来源追踪单位；facet 是该 component 内可独立选择和激活的静态单位。

每个 facet 分别声明其潜在协议需求、潜在协议实现、静态 extensions、权限请求以及可选的 activation 描述。Facet 激活后可以产生运行时 participant；manifest 中的 facet 本身不是 participant，也不证明任何实现已经运行。

## Motivation

一个发行物可以同时携带后台运行部分、终端界面、浏览器界面或纯声明内容。这些部分的加载方式、协议要求和贡献并不相同。若把声明放在 component 根级，安装器会误以为每次激活都需要全部环境，也无法判断某项 requirement 或 extension 属于哪段代码。

插件元数据如果只能通过执行 JavaScript 获得，安装器和市场又无法安全完成静态检查。产品专用的 `package.json` 字段也难以被其他运行时复用。

Manifest 因此需要表达：

- 发行物的身份、版本与来源关联；
- 它包含哪些可独立处理的 facet；
- 每个 facet 可能需要或实现哪些协议；
- 每个 facet 如何由理解相应 activation kind 的加载器激活；
- 哪些声明在执行代码之前即可校验；
- 安装或启用前需要展示哪些权限与影响。

## Guide-level explanation

以下 component 同时包含 DSH runtime、TUI 和 Web 三个 facet：

```yaml
apiVersion: manifest.dsh/v1alpha1
kind: Component
metadata:
  name: ai.openai.codex
  version: 0.2.3
  displayName: OpenAI Codex
spec:
  facets:
    - name: runtime
      activation:
        apiVersion: adapter.dsh/v1alpha1
        kind: CordisEntrypoint
        spec:
          module: dsh-codex
      extensions:
        - apiVersion: models.dsh/v1alpha1
          kind: ModelProvider
          metadata:
            name: openai-codex
          spec:
            title: OpenAI Codex
        - apiVersion: tools.dsh/v1alpha1
          kind: Tool
          metadata:
            name: imagegen
          spec:
            title: Image generation
            description: Generate or edit an image.

    - name: tui
      activation:
        apiVersion: adapter.dsh/v1alpha1
        kind: CordisEntrypoint
        spec:
          module: dsh-codex/tui
      protocols:
        requires:
          - apiVersion: presentation.dsh/v1alpha1
            kind: OpenExternal
            optional: true
      extensions:
        - apiVersion: commands.dsh/v1alpha1
          kind: Command
          metadata:
            name: codex
          spec:
            title: Manage OpenAI Codex

    - name: web
      activation:
        apiVersion: adapter.dsh/v1alpha1
        kind: BrowserEntrypoint
        spec:
          module: dsh-codex/client
```

`activation` 说明加载器怎样激活 facet。Manifest 不内建 `runtime`、`web`、`tui`、`local` 或 `remote` 等运行位置；这些名称在上例中只是 facet 的局部标识。`CordisEntrypoint` 与 `BrowserEntrypoint` 的 schema 和加载语义由 DSH adapter 定义。

没有 `activation` 的 facet 是纯声明 facet。加载器可以在不执行发行物代码的情况下接纳其 extensions。

Facet 中的 `protocols.supports` 是静态上限。激活产生的 participant 仍须发布本次实际可用的 support 子集。`extensions` 是对相应领域聚合点的静态贡献，不等同于实现该 extension 所属的整个协议。

## Reference-level explanation

### Document form

Manifest 使用完整的 YAML 1.2。标准不定义 YAML 子集，也不为 anchor、alias、scalar style、flow collection 或 tag 另设语法。

`manifest.yaml` 包含一个 YAML document，根节点为 mapping，并具有 `apiVersion`、`kind`、`metadata` 和 `spec`。字段类型与约束由 manifest schema 定义。YAML 能表达但 manifest schema 不接受的值，不构成合法 manifest。

文件名固定为 `manifest.yaml`。`.yml` 不作为替代发现名称。

示例使用 `apiVersion` 标识 manifest 对象版本。是否另设只描述文件 schema 的 `schemaVersion` 尚未决定。无论采用哪种方案，manifest 自身版本与其引用的各领域协议版本必须能够独立演进。

### Component identity

`metadata.name` 是稳定、带命名空间的 component id。`metadata.version` 是发行物版本，不是任何协议的版本。

Component 是以下事项的共同边界：

- 安装、升级和卸载；
- 发行物来源、digest 与签名；
- 版本关系和供应链记录；
- facets 的命名空间。

同一安装范围内不能同时存在相同 name 与 version 但内容不同的 manifest。安装器应记录发行物 digest 和来源，以便区分重打包或供应链异常。

Component 根级不声明运行时 protocol support。协议、extension 和 permission 声明属于具体 facet；否则实现无法确定哪次激活应受该声明约束。

### Facet identity

`spec.facets` 是非空序列。每项 facet 的 `name` 在所属 component 内唯一。静态 facet identity 由 component id、component version 和 facet name 组成。

Facet 是 composition 与 lifecycle 的最小选择和激活单位。一个 component 的多个 facets 可以：

- 在同一环境中同时激活；
- 分别在不同 endpoint 中激活；
- 只激活其中一部分；
- 采用不同的 activation kind；
- 包含没有可执行模块的纯声明内容。

Facet 名称不具有标准化的位置语义。名为 `web` 的 facet 不因名称而只能在浏览器中运行；加载能力由 `activation` kind 及其 schema 表达，选择结果由 composition 决定。

Facet 不是 core participant。Facet 被选中时，lifecycle coordinator 为本次 activation instance 分配在本地组合范围内唯一的 participant identity。Manifest 中的 requirements 成为该 planned participant 的需求；只有 activation 实际登记并通过 publication barrier 的 supports 才成为 live support。

第一版组件模型中，一个 activation instance 对应一个本地 component participant。一个 facet 可以在该 participant 上实现多份协议。需要独立协商身份的功能使用不同 facet；产品内建服务仍可产生不属于 manifest facet 的 participant。Connection view 可以为连接范围重新投影身份，但 provenance 必须保留本地 participant、component、facet 和 activation instance 的关联。

### Protocol declarations

`facet.protocols.requires` 和 `facet.protocols.supports` 使用 core requirement/support 的字段形状，但其静态语义不同：requirements 是选择该 facet 后将赋给 planned participant 的需求，supports 是该 activation 允许发布的上限。它们用于安装期兼容性、composition preflight 和影响分析。

静态 support 不构成以下事实：

- facet 已被 composition 选中；
- activation 已经成功；
- 当前配置启用了该协议；
- handler、端口或账号已经可用；
- 某条连接向对端公开了该协议；
- 对端获得了调用权限。

Manifest support 不能直接放入 core live declaration，也不能进入 connection offer。第三方 facet 激活后发布的 support 不得超出该 facet 的静态声明。运行时可以少发布或不发布；若 composition plan 将某项 support 作为激活成功条件，缺失会使激活失败或触发重新组合。

内建实现可以没有发行物 manifest。它们仍可直接产生带可归属身份的 live declaration。

### Activation

`facet.activation` 是由加载环境解释的版本化对象，包含 `apiVersion`、`kind` 和该 kind 拥有的 `spec`。每种 activation kind 自行定义：

- 如何定位与校验可执行内容；
- 如何创建 activation scope；
- 如何调用实现入口及接收注册结果；
- 是否需要特定运行时、隔离单元或宿主能力；
- 如何停用及报告无法安全卸载的情形。

Manifest 不定义通用 JavaScript entrypoint，也不假定 Cordis、Node.js、浏览器或某种 DSH profile。加载器只选择自己明确支持的 activation kind。

未知 activation kind 不使 manifest 文档在语法上无效。该 facet 对当前加载器不可激活；若 composition 需要该 facet，则产生不兼容诊断。加载器不能因碰巧能够 import 其中的路径而推断自己理解该 kind。

第一版每个 facet 至多包含一个 `activation`。同一逻辑功能需要多个加载模型时，应使用多个 facets，或由某个明确版本化的 activation kind 定义自己的变体选择。Manifest 外壳不规定隐式候选优先级。

### Activation definitions and drivers

理解 activation kind 的实现分为两个角色：

- activation definition 提供 schema、路径字段、静态兼容性和影响分析规则；
- activation driver 在运行环境中 prepare、activate 和 deactivate 对应 facet。

安装器或市场可以只安装 definition，从而校验 manifest 而不具备执行能力。Loader 只有注册了匹配版本的 driver，才可以向 composition 报告该 activation 可用。Definition 与 driver 的发现机制由实现和分发方案提供，不进入 core protocol registry；二者必须以相同的 `apiVersion` 与 `kind` 标识所理解的 activation contract。

Driver 接收经过校验的 activation 对象、选中 facet 的只读声明、composition plan 和由 lifecycle 创建的 scope。Driver 不接收整个发行物的合并能力，也不能代替其他 facets 发布声明。

Activation driver 必须在其将要加载的 component 之前由环境建立。Component 不能通过自己的 activation 对象要求 loader 先执行同一发行物中的未知 driver；那会绕过安装前验证并形成自举循环。Driver 可以由产品内建、由已受信 adapter 提供，或作为独立 component 经一个已有 driver 激活。

### Extensions and contributions

`facet.extensions` 保存静态声明。每一项 extension 都携带自己的 `apiVersion`、`kind`、在相应范围内唯一的 identity 和 `spec`。

Manifest 只要求 extension 的 `metadata.name` 为非空字符串。名称的语法和作用域由相应 extension definition 校验；例如 Tool 可以采用工具标识符，SessionEvent 可以采用包含 `/` 的事件类型。Manifest 不为所有领域强加同一套 local-name 语法。

Extension 的 schema、标识范围、是否允许多项、是否需要运行时 handler 以及冲突规则由所属协议或 composition rule 定义。Manifest 不假定所有 extension 都是 resource，也不为其定义统一 status。

Extension 随所属 facet 被选择。一个 facet 未被接纳时，它的 extensions 不进入 composition plan。纯声明 facet 的 extension 不需要以虚构的运行时 support 证明其存在；需要 handler 的领域协议则必须在 publication barrier 前验证 handler 与静态声明的 owner 对应。

### Permissions

权限请求属于将要使用权限的 facet。静态请求表示该 facet 可能申请的最大范围，不表示已经授权。

若多个 facets 需要相同权限，它们分别声明。授权界面可以合并展示，但 permission grant 和运行时 principal 仍绑定实际 activation instance，不能因同属一个 component 而自动共享。

### Component relationships

发行物版本关系位于 component 根级，协议 requirement 位于 facet。两者含义不同：

- 协议 requirement 表示该 facet 需要一项互操作规范；实现可以来自任意 component 或产品内建能力；
- component relationship 表示发行物整体明确依赖、建议、排斥或冲突于另一个发行物及其版本。

Component relationship 由 composition proposal 解释。能用协议 requirement 表达的关系不应退化为特定包依赖。Facet 之间若确实需要共同激活，应由 composition 的显式 activation constraint 表达，不能依赖 YAML 顺序或模块导入副作用。

### Static and live bounds

Manifest validator 只能确认静态形状与上限。运行时至少区分：

1. declared：facet 在 manifest 中声称可能注册的内容；
2. staged：activation 已登记、尚未公开的实现与 handlers；
3. live：越过 publication barrier 后实际可协商或调用的内容。

从 declared 到 staged 只能缩小，不能增加未声明的 protocol support、extension handler 或 permission request。Staged 到 live 还要经过 composition plan、协议校验和 permission policy。

### Static validation report

Manifest validator 返回机器可读报告，至少记录：

- validator 身份与版本；
- manifest 来源和 digest；
- 错误或警告对应的 manifest path；
- 重复或无效 facet identity；
- 未知协议、activation 或 extension；
- 需要交给 composition 与 permission 检查的声明。

“未知”与“无效”必须区分。只理解 manifest 外壳的工具仍可保留并展示未知版本化对象，不能声称已经完成其领域校验。

报告应能被 CLI、市场、CI 和图形界面消费，不以人类日志作为唯一输出。

## Security considerations

读取和校验 manifest 不执行发行物代码，也不自动加载其中列出的 activation。YAML tag 的解析不能触发网络访问或任意对象构造；解析结果仍需通过 manifest schema。

Manifest 是发行者声明，不是授权凭据。签名、来源信任、用户批准和运行时 sandbox 由分发与 permission 方案处理。

路径型 activation 字段必须在发行物边界内解析。加载器不能允许 manifest 通过相对路径逃出已验证的包内容。

Component 级安装信任不能自动扩大为所有 facet 的运行权限。Composition 和 permission 可以只接纳其中一部分。

未知 activation 对象中的代码或路径不得用于自动安装其 driver。Driver acquisition 是独立的安装与信任决策。

## Drawbacks

Facet 增加了一层身份与诊断路径。简单 component 仍需声明一个 facet，但由此换取静态声明、激活实例与运行时 participant 之间的明确关系。

独立 manifest 会与 `package.json`、扩展市场元数据或产品配置出现部分重复。安装工具需要明确哪个来源对每个字段具有权威性。

完整 YAML 1.2 需要实现使用合格的 parser，并处理 alias expansion、嵌套深度、输入大小和循环引用等资源风险。资源限制属于实现安全策略，不改变有效 YAML 的语法定义。

版本化 activation 与 extension 增加了 validator discovery 的要求。只理解 manifest 外壳的工具可以列出它们，但不能完成协议专属校验。

## Rationale and alternatives

### 只使用 component 根级声明

根级声明不能表达一个发行物内不同入口的独立需求，也会使未激活的界面模块给后台运行模块增加虚假依赖。Facet 将静态声明绑定到实际选择和激活边界。

### 只定义 entrypoints

Entrypoint 只说明调用哪段代码，不能表达该次激活拥有的协议上限、extension、权限和生命周期 owner。`activation` 是 facet 的加载描述，不取代 facet。

### 固定 `client`、`server`、`ui` 或 `workspace`

这些枚举只能描述特定产品当前的部署拓扑。DSH Standard 允许浏览器、终端、daemon、远端 workspace、进程内测试或其他实现按需组合；加载条件由开放的 activation kind 表达，不写入 manifest core schema。

### 把 facet 直接作为 participant

Facet 是可签名、可静态读取的发行物声明；participant 是由 coordinator 为一次 activation/协商创建的运行实体。同一 facet 可以产生多个 activation instances，也可能尚未激活。第一版虽规定每个 activation instance 对应一个本地 participant，二者身份仍不能合并，否则会再次把“声明过”误当成“当前可用”。

### JavaScript manifest

可执行 manifest 能动态计算字段，却会使安装前检查本身成为代码执行。静态 YAML 更适合索引、签名和可复现验证。

### 只使用 `package.json`

DSH Standard 不限于 npm，且不同包管理器对未知字段、发布内容和签名有不同规则。`package.json` 可以指向 manifest，但不承载唯一规范格式。

## Relationship to other proposals

- Core 定义运行时 participant 的协议声明，不读取 manifest；
- Composition 选择 facets、检查静态约束并生成 activation plan；
- Lifecycle 通过匹配的 activation driver 为选中 facet 创建 activation instance 和 publication barrier；
- Permission 对 facet 的静态请求作出决策，并把 grant 绑定运行实例；
- Connection 只接收经 endpoint policy 裁剪的 live participant declarations；
- 产品 adapter 定义 activation kind，并把标准 publication 映射到产品扩展点。

## Unresolved questions

### Manifest version fields

单一 `apiVersion` 与独立 `schemaVersion` 是互斥的设计方向。需要先明确工具是否必须在不理解 manifest kind 的情况下只升级文件 schema，再选择其中一种。

### Facet activation constraints

需要共同激活、互斥或按组原子发布的 facets，应采用 composition 拥有的通用约束对象，还是由相关协议的 composition rule 表达，仍需通过多入口 component 验证。

### Signatures and provenance

签名 envelope、透明日志、构建来源和市场验证属于独立的分发与 provenance proposal。

### Embedded manifests

单文件可执行程序或非文件分发是否允许在其他容器中嵌入同一 YAML document，需要与发现规则一起确定。
