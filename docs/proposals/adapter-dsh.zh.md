# `@dsh-std/adapter-dsh` 设计提案

- 文档类型：设计提案
- 状态：草案
- 日期：2026-08-16

## Summary

`@dsh-std/adapter-dsh` 是 DeepSeek Harness 对 DSH Standard 的实现与适配层。它把 Cordis plugin、DSH command、Agent、workspace、UI 和其他产品服务映射到实现选择的标准协议。

Adapter 不是可移植协议，也不是所有标准能力的中央注册表。它由一个小型基础层和按协议安装的映射组成；新增标准协议不要求修改 core，也不应让未使用该协议的 DSH profile 获得额外依赖。

Cordis、Typert、DSH Agent 与具体 UI 类型只出现在 adapter 内部。

## Motivation

标准协议描述互操作语义，不知道 DeepSeek Harness 如何加载插件、定位 session、执行命令、注册 tool 或创建 UI。产品必须完成这些映射，但插件不应各自 patch 同一套内部 API，也不应让 Host、TUI 或 connector 依赖某个业务插件。

DSH adapter 提供共同的产品边界：

- 读取受支持版本的 `dsh-plugin.json`，并把 Host facet 投影到 DSH activation；
- 把 Cordis activation/disposal 映射到标准 lifecycle；
- 为标准 protocol support、event subscription、permission grant 和 contribution 建立 owner；
- 按需把 DSH 内部服务映射为 command、tool、model、presentation 或 connection 实现；
- 向诊断与 provenance 报告映射失败，而不是把静态声明当作 live implementation。

## Guide-level explanation

### Base adapter

基础层向 DSH profile 安装一个内部 composition service。该 service 管理：

- 已验证的 component manifest 与 selected facets；
- facet activation instance 与 lifecycle cleanup scope；
- 当前 core protocol declarations；
- permission decisions 与 scoped API issuer；
- registration ownership 和诊断记录。

这些是 DSH 实现细节。标准插件只通过 manifest、已协商协议 API 和 SDK facade 使用它们，不取得裸 Cordis context。

Adapter 不存在时，DSH 按原有方式工作。其他插件不能假定标准 SDK backend 一定存在；需要它的 facet 由其 activation kind 或 DSH 产品依赖显式表达。

### Bootstrap boundary

Manifest 不能自行令宿主发现并执行 adapter。DSH 必须通过已有的正式插件安装或 profile 组合机制挂载基础 adapter；这是一次产品 bootstrap，不是每个标准 component 各自 patch DSH。

基础 adapter 激活后向 DSH loader 注册它实现的 activation definitions、drivers 和 SDK backend。此后安装器发现 `dsh-plugin.json`，按 `$schema` 与 `manifestVersion` 校验受支持的 Manifest 版本，再把其中的 Host facet 投影到内部 activation。插件不需要知道 `dsh-host`、TUI、Web 或 adapter 的内部 service 名称。

若 DSH 尚未提供 component manifest discovery，过渡安装器可以生成普通 profile/plugin 配置以挂载已识别的 component，但不能修改 component 代码或把未选 facets 合并成一个入口。DSH 获得正式 discovery API 后应替换该过渡层，而不改变 manifest 或领域协议。

### Manifest mapping

Adapter 对 Manifest 的处理止于产品映射，不改变 Manifest 或领域协议语义。它必须保留原始文件 digest、Manifest version、projection digest 和字段路径。

对于 Community v0.15 Manifest：

- `facets.host.entry` 解析为包内模块，并由 `facets.host.apiVersion` 选择兼容的 Host activation driver；
- `requires.contracts` 形成该 facet 的 protocol requirements；
- command contributions 形成没有子节点的标准 `Command` extensions；
- permissions 与 subscriptions 先由其各自 definition 解析，再进入 permission/event adapter；
- source、artifact、compat 和 override 信息只进入 admission/provenance；
- Manifest 未声明 potential supports 时，Adapter 不从模块导出或 Cordis service 猜测静态 supports。

协议坐标不在 Adapter 的内建协议集合中，不足以判定 Manifest 非法。只要当前 Host 安装了相应 definition 和产品 mapping，它可以参与 composition；definition 缺失时按 requirement 的 required/optional 语义报告。Adapter 不把组织命名空间改写成 DSH 私有 service name。

Namespaced Manifest extension 若没有对应 definition，可以按 Manifest 版本规定保留或忽略，但不能注册 handler、申请隐含权限或形成 live support。

### Protocol adapters

每份领域协议可以有独立的 DSH mapping。例如：

- command adapter 把 DSH 命令目录与执行入口映射为 command protocol；
- tool adapter 从 Agent/ToolRuntime 生成 tool discovery，并按当前 policy 投影 schema；
- model adapter 把已安装 provider 和动态状态映射为 model catalog；
- agent adapter 把 Agent registry、状态和控制入口映射为 AgentControl/AgentConfiguration；
- session adapter 把 Session persistence、event history 与 fork 映射为 SessionCatalog/SessionHistory；
- workspace adapter 把 WorkspaceRegistry 与 Workspace entity 映射为 WorkspaceCatalog/WorkspaceSessions；
- content adapter 把 DSH 可持久化的附件存储映射为 ContentStore；
- presentation adapter 把 invocation-scoped operation 交给 TUI、Web 或其他 presentation participant；
- connection adapter 为 DSH profile 创建 endpoint view、connector 或 acceptor。

协议 adapter 在 activation 时向 core declaration 发布实际 support。加载了 adapter 包但底层 DSH service 不存在、配置未启用或初始化失败时，不发布该 support。

### DSH activation kind

`@dsh-std/manifest` 不定义通用 JavaScript entrypoint。Adapter 定义 DSH 专属 activation kind，例如：

```yaml
apiVersion: adapter.dsh/v1alpha1
kind: CordisEntrypoint
spec:
  module: ./lib/index.js
```

DSH loader 校验路径和 schema 后，按 composition plan 激活所属 facet。每次 Cordis plugin activation 与标准 activation instance 建立 owner 关系。一个 component 中未被当前 profile 选择的其他 facets 不会因此加载，也不会令 plugin tree 等待其所需服务。

### Publication

领域 adapter 或 facet activation module 可以向基础层发布协议实现。Publication 至少包含：

- activation instance owner；
- core support declaration；
- 对应协议 adapter 能校验的实现对象；
- lifecycle cleanup；
- 可选的动态状态读取器。

基础层只负责 owner、静态范围和 lifecycle 的共同检查。Handler 类型、operation、目录和 connection message 均由相应协议 adapter 校验。

成功 publication 在 facet activation instance 越过 lifecycle publication barrier 后进入 live declaration。失败或 disposal 会原子撤销该 owner 的声明与实现。

## Reference-level explanation

### Activation sequence

一个带 DSH activation 的 facet 按以下顺序激活：

1. 静态读取 Manifest，校验其版本并投影为 component/facet 声明；
2. 由 composition 选择 facets，并计算协议、component relationship、extension 和 permission 的候选 plan；
3. 为 selected facet 创建 activation instance、scope 与受限 SDK facade；
4. 由 activation kind handler 加载经过验证的 Cordis module；
5. 收集该 instance 注册的协议实现、event handler 和其他 contribution；
6. 校验实际 publication 没有超出 manifest 与 grant；
7. 越过 publication barrier，发布 live core declaration；
8. 在停用、失败或 reload 时按 owner 撤销全部 registration。

任一步失败都产生带 component、stage 和 path 的结构化诊断。Adapter 不保留半激活 publication。

### Ownership

每项映射结果都记录 activation instance owner。至少包括：

- Cordis service 与 listener；
- standard protocol support 与 attachment handler；
- DSH command/tool/model 映射；
- event subscription 与 interceptor；
- UI contribution；
- transitional hook、wrapper 或 patch；
- background task 与临时资源。

Owner record 使用 lifecycle cleanup scope。DSH 内部 API 无法提供 disposer 时，adapter 必须实现恢复逻辑或把该目标声明为不可安全热重载。

### Protocol declarations

Adapter 区分三类事实：

- declared support：所属 facet 在 manifest 声称可能实现的上限；
- staged support：当前 activation 已登记、尚未公开的实现；
- live support：publication barrier 后能够参与 core/connection 协商的实现。

连接 view 只能从 live support 生成 offer，并再次经过 peer policy 与 permission 裁剪。完整 profile inventory 不直接发送给对端。

### Command mapping

Command adapter 读取 selected facets 中的 `Command` extensions，并与 DSH 权威命令 registry 按 owner 对应。目录只返回同时满足以下条件的条目：

- extension 已通过 command schema 校验；
- 所属 facet activation instance 为 active；
- DSH registry 中存在同一 owner 的实际 handler；
- 当前 context 与 permission 允许显示和执行；
- 需要的 presentation protocol 已在本次 invocation/connection 中协商。

执行仍进入 DSH command service。Command adapter 负责把标准 context reference 映射到 Agent/session，并按 command protocol 生成结果。

### Tool and model mapping

Tool adapter 以 DSH 当前 ToolRuntime 为权威来源，manifest extension 只补充静态目录信息。工具是否可用、是否披露 schema 和是否允许调用分别由运行时状态与 policy 决定。

`ToolOverride` handler 由所属 facet 发布。Adapter 将它应用到 DSH 的 Agent-scoped tool view，并为以后创建的 Agent 建立相同映射。Handler 只接收原工具定义并返回替换定义；Agent 枚举、ToolRuntime change event 和 scoped registration 属于 adapter。Composition 已拒绝同一 target 的多个 live owner。

Model adapter 将 `ModelProviderHandler` 映射到 DSH 的 LLM registry。它把 DSH message、tool schema 和 attachment reference 转换为 model 标准类型，并将标准 stream chunk 转回 DSH stream；凭据始终由 provider handler 自己持有，不进入 adapter 或 connection catalog。没有可执行 handler 的 resource 只参与目录投影。

### Session mapping

Session adapter 将 DSH 的 live Session registry 与 SessionPersistence 投影为同一 `sessionDomain`。Catalog list/get 只返回当前 scope 可见的 descriptor；History read/follow 从权威 Session event 序列产生 opaque cursor，不向 client 公开日志目录或文件 offset。

DSH 提供的 create、rename、delete 或 fork 操作只有在其公开领域 API 可以保持对应原子性与 lifecycle 语义时才进入 support spec。缺少某项产品操作不会阻止 adapter 发布只读 Catalog/History；adapter 不能绕过 Session invariant 伪造该 operation。

Session adapter 还将 selected facets 的 `SessionEvent` resources 映射到 DSH 会话事件 vocabulary。DSH 的内建事件集合构成基线，组件 contribution 按 activation instance 记录 owner；停用组件不会删除基线事件或其他 owner 的注册。

事件写入仍使用 DSH Session API。Adapter 根据 `replay` 检查持久 envelope 是否具备相应的未知事件处理语义；不能保存 ignorable 标记的产品版本不声明完整支持该类写入。

### Agent mapping

Agent adapter 以 DSH Agent registry 和 Agent handle 为活动实体权威来源。它映射 list/create/attach/inspect、turn submit/steer/cancel、status event 和 disposal，并为每个标准 attachment 维护 controller lease；TUI 的 Channel、React/Ink state 和产品事件 class 不进入标准 payload。

Agent 关联的 DSH Session 与 cwd 分别转换为 SessionReference 和 WorkspaceReference。转换失败时省略相应可选关联或拒绝要求该关联的操作，不能把裸 session id、cwd 或 Agent object 填入标准 reference。

AgentConfiguration descriptor 从当前 Agent runtime 实际支持的配置生成。Model、effort、preset、sandbox 等产品字段只有在具备标准 key 语义或明确的实现 namespace 时才公开；adapter 不把所有配置对象原样透传。

### Workspace mapping

Workspace adapter 以 DSH `WorkspaceRegistry` 和 `Workspace` entity 为权威来源：

- registry list/get/resolveByPath 映射 Catalog list/get/resolve；
- registry create/delete/insertBefore 映射 register/unregister/reorder；
- entity setTitle/status 映射 rename/status；
- entity sessionIds、attachSession、detachSession、insertSessionBefore 映射 WorkspaceSessions。

DSH path 先由 WorkspaceRegistry 自身 canonicalize 和验证。Adapter 不自行重写 symlink、大小写或 membership invariant，也不把 directory picker、`ctx.fs` 或 shell executor 并入 WorkspaceCatalog。

Workspace mutation 的公开 DSH API只保证串行提交时，support 声明 `mutationConcurrency: 'serialized'`。Adapter 不能在临界区外比较 timestamp 后声称实现了 `revision-checked`。

DSH workspace domain 中保存 Session archive 状态属于产品存储选择。它不进入 WorkspaceSessions；需要远端公开时，由 DSH namespaced Session visibility protocol 或产品 UI policy 表达，不能因此扩张基础 SessionCatalog。

### Content mapping

Content adapter 只在 DSH 存在能够保证 stable reference、有界 transfer、authorization 和 retention 的附件存储时发布 ContentStore。Prompt 中的临时本地图片路径、Buffer object、模型 provider 私有 image handle 或任意 URL 都不能直接充当 ContentReference。

导入本地文件时，拥有相应 DSH filesystem permission 的调用方读取字节，再通过 ContentStore put；Content adapter 本身不获得任意 filesystem root。Session adapter 在持久 event 引用 content 前取得 Session retention lease。

### Presentation mapping

Presentation support 由当前用户侧 participant 发布，可以来自 TUI、Web、GUI 或其他客户端。DSH runtime 只在 invocation agreement 与 permission grant 覆盖的范围内取得 scoped presentation API。

Question、approval 和 secret input 映射到当前 DSH UI 已有的交互 store 时，adapter 保留 request identity、单一 authority、cancel 与 deadline。多个 UI 同时存在时由 connection/composition policy 选择，不能把同一 approval 广播后接受最快响应。

Device code、secret input、approval token 和其他短期值只存在于 invocation scope。Adapter 不把它们写入普通 session history 或可重放 event stream。

### UI mapping

DSH profile 选择 client、terminal 或其他 UI facet，并装入相应 shell 与 surface owners。Profile 选择是 composition 输入；它不是 UI contribution，也不替代 surface requirement 与 agreement。

DSH 原生 client module metadata 映射为对应环境的 facet activation definition。一个被选择的 client facet 可以在同一 activation instance 中向多个 DSH shell registry 注册 UI。Adapter 为每项注册保存 owner 与 disposer，并在 facet deactivate、activation rollback 或 profile composition 替换时按 lifecycle 撤销。插件内部的组件、表单字段、样式和 locale 不逐项投影为标准 contribution。

DSH 的 settings section、tool result view、sidebar entry、terminal scene 等具体接缝只有在各自 surface definition 存在时才映射为 `@dsh-std/ui` surface。其 slot 名、renderer ABI、cardinality 与内容 schema 属于 DSH 生态协议或 adapter mapping，不进入基础 UI envelope。声明一个 UI facet 也不表示它取得所有 DSH UI registry 的访问权。

DSH profile 可以保证某些 shell packages 存在，adapter 因而可以发布相应 surface support；support 仍必须来自当前 active owner。不存在于当前 profile 的 Web 或 terminal surface 不得形成悬空依赖，也不得阻止同一 component 的非 UI facets 激活。

### Connection mapping

Connection adapter 把 DSH 的 composition、permission 和 activation scope 接入 Connection Host。标准 facet 通过 ParticipantPublicationService 发布 live declarations 和 implementation endpoint；传统 DSH 内建服务由 adapter 作为有 owner 的 participant publication 投影。只有当前 consumer scope 和已认证 peer 可见的声明进入 `EndpointConnectionView`。

Connection Host implementation 提供 Connection Service、Participant Publication Service、provider registry、wire 和 acceptor。TUI、Web 与业务插件只要求标准 service；SSH 集成通过 Host provider SPI 贡献 target 与 bootstrap。它们都不需要导入 adapter 的内部 registry。Adapter 负责把 agreement 和 attachment 交给当前 DSH runtime 中相应协议的 participant。

Carrier-specific metadata 不进入 command/tool/model 等领域 API。

### Hooks and product API drift

当 DSH 尚无公开扩展点时，adapter 可以在内部使用定向 hook、method wrapper 或 loader patch。此类实现必须：

- 绑定明确 owner 与 lifecycle scope；
- 验证目标签名和适用版本；
- 在目标不存在的 profile 中不注册等待不到的依赖；
- 卸载时恢复原状态；
- 把独占目标和版本范围报告给 composition/provenance；
- 对 API 漂移给出结构化不兼容结果。

标准插件依赖的是 adapter 提供的协议 API，不依赖 hook 目标。DSH 获得正式扩展点后可以替换内部映射，而不改变标准协议。

Hook 只能位于 adapter 的产品映射或一次 bootstrap 边界。某个 component 若需要 adapter 尚未提供的 DSH 能力，应增加领域协议或 DSH 专属 extension/activation contract；不能在自身 activation 中重新 patch 同一个产品目标。

## Security considerations

Adapter 是 DSH 产品权限的执行点。标准 SDK facade 不能暴露超出 permission grant 的 Cordis、fs、net、session 或 UI 接口。

来自 connection 的 participant id、agreement 或 message 不构成本地 component principal。Connection adapter 完成 plan lookup 后，领域 adapter 仍按本地 attachment scope、grant 和 DSH guard 执行。

Adapter 在跨信任域前清理错误 stack、本地路径、凭据和内部 service object。

## Drawbacks

把领域映射拆成独立 adapter 会增加包和 registration 数量，但避免一个基础 service 随所有标准协议膨胀。

旧 DSH API 若没有 owner、disposer 或 staging 状态，完整 publication barrier 需要 wrapper 或产品侧扩展点支持。

同一标准协议可能存在多个 DSH mapping。Composition 必须显式选择或报告歧义，不能让后注册者覆盖前者。

## Rationale and alternatives

### 一个包含所有协议的全局 adapter

这种实现会让 connection、UI、command 和 model 的更新相互绑定，也让不相关 profile 等待不存在的服务。基础层只保留共同 lifecycle/ownership，领域 mapping 按需安装。

### 每个插件直接实现 Host RPC

Host 和客户端将被迫认识每个插件。插件实现标准领域协议后，Host、TUI、Web 或 GUI 只需实现相同协议和 connection。

### 从 Cordis plugin tree 推断 support

Cordis entry active 只能证明插件回调结束，不能证明某项标准协议已有可用实现。Live support 来自经过协议 adapter 校验并越过 publication barrier 的 registration。

### 把 DSH 类型加入标准协议

其他产品与语言不使用 Cordis、Typert 或 Agent。产品类型止于 adapter，标准对象保持实现无关。

## Unresolved questions

### Base service API

需要通过实际 command、tool 和 connection adapter 验证基础 publication/ownership API 的最小形状，再决定是否作为稳定的 DSH 插件开发接口发布。Facet module 不应再手写完整 registry snapshot；标准 SDK 的 `implement` 与 `publish` 应成为 facet-scoped publication 入口。

### Existing plugin adoption

传统 DSH plugin 没有 `dsh-plugin.json` 时，是由安装器生成过渡 manifest、由 adapter 提供 legacy participant，还是只在显式启用兼容层时纳入 composition，尚未确定。

### Conformance

每个领域 adapter 需要协议级 fixtures 和产品集成测试。哪些测试属于标准 conformance、哪些只验证 DSH mapping，将在 verification proposal 中定义。
