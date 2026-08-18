# `@dsh-std/ui` UI Facet 与 Contribution 设计提案

- 文档类型：设计提案
- 状态：草案
- 日期：2026-08-18

## 摘要

`@dsh-std/ui` 定义 UI facet 如何要求 shell surface、如何在激活期间注册持久 contribution，以及 shell 如何维护 contribution 的归属、冲突和生命周期。

Profile 是 composition 的环境选择，不是需要逐项注册的 UI resource。一个发行物可以包含面向不同 shell 的 facets；当前 profile 只选择能够在本环境激活且 requirements 得到满足的 facets。被选中的 UI facet 可以在一次 activation 中注册多个 contributions，而不必把每个内部视图重复列入静态 Manifest。

本协议不规定统一 widget tree，不规定 React、DOM、Ink 或编辑器 API，也不把某个产品的 slot 名称提升为通用标准。具体 shell 通过独立 surface definition 描述它支持的 placement、内容模式、冲突规则和本地执行 ABI。

## 范围

本提案规定：

- UI shell 与 UI facet 的声明和协商边界；
- profile 选择与 facet activation 的关系；
- host-rendered 与 local-module 两类 contribution；
- 静态 contribution descriptor 与运行时 registration 的区别；
- contribution ownership、view instance、更新和清理；
- 本地与远端 UI contribution 的边界；
- surface definition 的校验、冲突与兼容性要求。

本提案不规定：

- 产品使用何种 profile 文件或内部依赖注入容器；
- shell 的导航结构、像素布局、快捷键或主题实现；
- Agent、Session、Workspace、Settings、Tool 等业务数据模型；
- invocation-scoped question、approval、notification 或 external redirect；
- 任意跨端可执行 UI 代码或通用虚拟组件树。

## 术语

**UI shell** 是拥有渲染器、布局、输入路由和 view instance 的程序或程序部分。

**UI profile** 是产品 composition 对某类用户界面的选择结果。Profile 可以装入一组适用于该 shell 的 facets，但 `@dsh-std/ui` 不规定 profile 的文件格式，也不以 profile 名称代替协议协商。

**UI facet** 是面向某类 shell 激活的 component facet。它通过 activation definition 指定执行方式，并通过 protocol requirements 声明所需 surface 与领域能力。

**surface** 是 shell 提供的一个具名 contribution contract。Surface 由协议坐标标识，其 definition 规定 descriptor schema、支持的内容模式、placement、cardinality、排序、状态和调用边界。

**contribution** 是 active facet 向某个 surface 注册的、由 activation instance 拥有的 UI resource。

**view instance** 是 shell 根据 contribution 创建的具体显示实例。一个 contribution 可以没有已打开的 view，也可以在 surface definition 允许时产生多个 view instances。

## 协议坐标

`v1alpha1` 定义以下基础能力：

| `apiVersion` | `kind` | 作用 |
| --- | --- | --- |
| `ui.dsh/v1alpha1` | `ContributionHost` | 为当前 activation scope 协商并签发 surface registration API |
| `ui.dsh/v1alpha1` | `UiContribution` | 可选的静态、纯数据 contribution extension 外壳 |

`ContributionHost` 不代表某个 shell 支持任意 UI。Requirement 与 support 必须列出具体 surface coordinates；未列出的 surface 不属于 agreement。

## Profile 与 facet 选择

Component 可以同时携带业务 facet 和一个或多个 UI facets。Composition 必须分别处理这些 facets：

- 安装 component 不表示激活其全部 facets；
- 一个 facet active 不表示同一 component 的其他 facets active；
- Profile 可以只选择适用于当前 shell 的 UI facet；
- 无 UI 的 profile 可以只选择业务 facet；
- 一个 UI facet 的 required surface 不可满足时，该 facet 不得进入 active plan；除非 component relationship 明确要求它，否则不得据此判定其他 facets 失败。

Profile 可以保证某组 UI shell packages 总是存在。该保证属于 composition 输入，使相应 support 成为候选；它不把这些 packages、内部 services 或 slot names 写入 `@dsh-std/core`，也不免除 requirement、permission 和 lifecycle 检查。

UI facet 的 activation definition 决定其代码如何进入 shell。不同运行环境可以采用不同 activation kinds。`@dsh-std/ui` 只要求 activation instance、scoped agreement 和 cleanup ownership 一致，不规定 loader 如何 import module。

以下示例表达一个 UI facet 需要两个 surface。坐标仅用于说明结构；其语义必须由对应 definitions 决定：

```ts
{
  name: 'client-ui',
  activation: {
    apiVersion: 'lifecycle.dsh/v1alpha1',
    kind: 'UiModule',
    spec: { module: './client' },
  },
  protocols: {
    requires: [{
      apiVersion: 'ui.dsh/v1alpha1',
      kind: 'ContributionHost',
      spec: {
        surfaces: [
          { apiVersion: 'example.ui/v1alpha1', kind: 'Preferences', mode: 'host-rendered' },
          { apiVersion: 'example.ui/v1alpha1', kind: 'ArtifactView', mode: 'local-module' },
        ],
      },
    }],
  },
}
```

Facet 激活后可以向两个 surface 各注册一项 contribution。Manifest 不需要重复描述组件内部的每个按钮、表单字段、子视图或渲染节点。

## `ContributionHost`

### Requirement

概念数据结构为：

```ts
type UiContentMode = 'host-rendered' | 'local-module'

interface UiSurfaceRequirement extends ApiReference {
  readonly mode: UiContentMode
  readonly spec?: unknown
}

interface ContributionHostRequirementSpec {
  readonly surfaces: readonly UiSurfaceRequirement[]
}
```

同一 requirement 中的 surface 全部为必需。需要可选 surface 时，facet 必须使用 core 的 optional requirement 语义形成独立 requirement，不得在 surface descriptor 中使用无法参与 composition 的提示字段模拟 optional。

Requirement 中的 `spec` 由 surface definition 校验。Base UI protocol 不解释 placement、renderer version、field kinds 或工具卡类型。

### Support

概念数据结构为：

```ts
interface UiSurfaceSupport extends ApiReference {
  readonly modes: readonly UiContentMode[]
  readonly spec?: unknown
}

interface ContributionHostSupportSpec {
  readonly surfaces: readonly UiSurfaceSupport[]
}
```

Shell 只能声明自己实际能够接纳、渲染并清理的 surface 和 mode。Profile 保证某个 shell 存在，不表示该 shell 自动支持所有 surfaces；support 必须来自当前 composition 中 active 的 surface owners。

同一 coordinate 的多个 support 候选必须按 surface definition 与 composition policy 选择。不得以 package 加载顺序、注册顺序或 UI facet 名称隐式选择 provider。

### Agreement

Agreement 包含被接纳的 surface、mode、surface-specific agreement 和一个绑定当前 activation instance 的 registration facade。

Facade 必须拒绝：

- agreement 未包含的 surface；
- 未协商的 content mode；
- 不满足 surface schema 的 descriptor；
- 不属于当前 activation scope 的 owner identity；
- 已关闭 scope 上的新 registration。

Facade 是 scoped capability，不是全局 UI registry。Facet 不得保存 facade 并在自身停用后继续注册。

## Contribution registration

概念 registration 为：

```ts
interface UiContributionDescriptor {
  readonly id: string
  readonly surface: ApiReference
  readonly placement?: string
  readonly content: JsonValue
}

interface UiContributionRegistration {
  readonly descriptor: UiContributionDescriptor
  readonly localModule?: unknown
}
```

`id` 在 activation instance 与 surface 范围内唯一。需要跨重启保存 view state 的 surface 必须以 component identity、facet identity、contribution id 和 surface coordinate 共同形成持久键，不能只使用显示标题或注册序号。

`content` 必须是可按 surface schema 校验的 JSON value。`localModule` 是同一执行环境中的不透明可执行值，只允许用于 `local-module` mode，不能进入 Manifest、connection message、diagnostic 或持久状态。

Registration 成功后返回 lease 或 disposer。关闭 lease 必须移除 contribution 及其 view instances，并取消由 surface host 为它建立的订阅。

只有具备独立 identity、placement、lifecycle 或冲突语义的 shell resource 才是 contribution。组件内部的按钮、React child、Ink node、CSS rule、locale string 和私有 state 不因出现在 UI 中而分别成为标准 registration。

## 内容模式

### Host-rendered

`host-rendered` contribution 只包含经过 surface schema 校验的数据。Shell 拥有布局、renderer、accessibility、输入控件和主题，并负责把 descriptor 转换为本地 UI。

Surface definition 必须规定：

- descriptor 的字段、长度和数量边界；
- 文本是否允许 markup，以及允许的 markup 子集；
- placement、cardinality、排序和冲突规则；
- 用户操作产生的结构化 action；
- state 的可见性、更新和持久化规则；
- 非法 descriptor 是拒绝整项 contribution，还是按定义允许的方式降级。

Surface 必须规定与其呈现环境相符的输入消毒与资源边界。文本、markup、图标引用和其他外部内容必须被视为不可信数据；字段名称本身不构成绕过 sanitizer 或内容安全策略的理由。

由 shell 统一呈现的设置项、状态项、动作入口和声明式菜单通常适合使用此模式。Secret 字段只能保存 credential reference；secret value 不得进入 descriptor、普通 settings document 或 view persistence。

### Local-module

`local-module` contribution 由与 shell 同一信任和执行环境中的 active facet 提供可执行 view factory 或 handler。它适合无法由某个 host-rendered surface schema 忠实表达的界面。

Surface definition 必须规定本地模块 ABI，包括：

- factory 或 handler 的调用形状；
- shell 注入的 renderer、UI kit、owner props 和 scoped clients；
- module 可以创建的 view instances；
- error boundary、取消和 cleanup；
- renderer compatibility 与重复 runtime 的处理规则。

Facet 必须使用 shell 注入的 renderer runtime。若 surface ABI 以 React、Ink 或其他具有实例 identity 的 runtime 为基础，插件不得通过私有副本创建不兼容的 hooks、elements 或 contexts。Surface host 必须在激活或打开 view 时给出确定性 incompatibility 错误，不得把 renderer mismatch 留成无归属的异步崩溃。

Local module 可以调用 agreement 中授予的领域 clients；它不能因运行在 shell 进程内就取得 shell root、任意 service container、其他 component state 或未经授权的 filesystem/network API。

## 静态 `UiContribution` extension

Surface definition 可以要求 contribution 在执行代码前可见，例如安装器需要显示 UI 影响、composition 需要解决独占 placement，或 policy 需要在 activation 前审批。此时 facet 可以声明纯数据 `UiContribution` extension：

```ts
{
  apiVersion: 'ui.dsh/v1alpha1',
  kind: 'UiContribution',
  metadata: { name: 'account-settings' },
  spec: {
    surface: { apiVersion: 'example.ui/v1alpha1', kind: 'Preferences' },
    placement: 'account',
    mode: 'host-rendered',
    content: { title: 'Account' },
  },
}
```

静态 extension 只能包含可验证数据，不能包含 module path、function、DOM node、renderer element 或产品 service name。

Surface definition 必须明确以下一种 registration policy：

- `static-only`：composition 接纳 extension 后由 shell 创建 contribution，facet 不重复注册；
- `declared-handler`：静态 descriptor 先进入 plan，active facet 只按 identity 绑定本地 handler；
- `runtime`：不要求静态 extension，active facet 直接注册 contribution。

默认 policy 为 `runtime`。因此一个 profile-specific client facet 可以在激活时注册多个 native surfaces，而不在 Manifest 中逐项复制 shell registration。Manifest version 若未定义 UI extension point，不得把保留字段解释为 `UiContribution`；特别是旧版本中被约束为空的 `panels` 字段不能由实现单方面赋予新语义。

## Surface definition

每个 surface coordinate 必须具有可发现的 definition。Definition 至少规定：

- requirement、support、agreement 与 descriptor 的 validator；
- 支持的 content modes；
- registration policy；
- placement 和 contribution cardinality；
- identity、排序与冲突规则；
- view state 与 action schema；
- local-module ABI（若支持）；
- descriptor 是否允许跨 endpoint 传输；
- permission 与 privacy 要求；
- conformance cases。

Surface definition 可以映射到产品内部 slot、route、panel registry 或 screen stack，但这些内部名称不进入 base UI envelope。Adapter 必须保持 contribution owner 与 disposer；不能只调用内部 register 后丢失清理句柄。

List surface 必须定义稳定排序，不能把异步 activation 完成顺序作为用户可见顺序。Single surface 必须在 composition 阶段解决唯一 owner；运行时后到者不得静默覆盖现有 contribution。Keyed surface 必须定义 key namespace 和 duplicate policy。

## State 与 action

Shell 拥有 view instance 的呈现状态。Surface definition 必须把以下状态明确区分：

- shell-local state，例如展开、选择、滚动位置和 panel width；
- contribution state，例如当前 tab 或筛选条件；
- domain state，例如 Session、Workspace、credential status 或 tool result。

Domain state 必须来自相应领域协议，不得复制到 UI persistence 作为新的权威来源。Surface 只有在 definition 提供 versioned codec 时才能持久化 contribution state。默认情况下 state 为 shell-local、不可跨端共享，并在 contribution lease 关闭后释放。

Host-rendered action 必须是 surface 定义的结构化数据。调用 Command、Agent、Workspace、Settings 或其他领域能力时，shell 使用当前 view instance 获得的 scoped client。Action 不能包含任意 method name 并要求 shell 在全局 service container 中反射调用。

## 本地与远端

建立 connection 不会自动把远端 facets 激活到本地 UI profile，也不会把远端 Manifest 中的 module path 当作浏览器或终端代码加载。

`local-module` contribution MUST NOT 跨 endpoint 传输。远端 endpoint 不能发送 JavaScript、Wasm module、DOM node、renderer element、本地路径或 callback 作为 UI contribution。

某个 surface 若允许远端 `host-rendered` descriptor，必须定义独立的 catalog/snapshot/subscribe 消息、origin、更新顺序、撤销语义、大小边界和 permission。Connection 只承载该 surface 已协商的消息；不存在通用“发送任意 UI contribution”操作。

本地 UI facet 可以使用 Agent、Session、Workspace、Command、Presentation 等标准 connection clients 展示并控制远端业务状态。这不要求远端安装同一 UI module，也不要求每个业务插件实现一套 UI transport。

## Lifecycle

Contribution 的 owner 是注册它的 activation instance。Registration 必须自动进入该 instance 的 cleanup scope。

Facet deactivate、activation rollback、composition plan 替换或 registration lease 关闭时，shell 必须：

1. 停止为该 contribution 创建新 view instance；
2. 取消正在进行的 surface action 和订阅；
3. 关闭或替换现有 view instances；
4. 释放 surface host 为其持有的资源；
5. 从 catalog 和布局中移除 contribution；
6. 发布不包含 secret 的结构化 lifecycle 结果。

一项 contribution 清理失败不能阻止其他 contribution 清理。Shell 必须把失败归属于 component、facet、activation instance、surface 和 contribution id。

UI profile 卸载时，surface owners 应先拒绝新 registration，再撤销 child contributions，最后释放自身 renderer resources。具体拓扑顺序来自 composition plan，不能依赖 module import 顺序。

## 错误

实现至少应区分以下错误：

- `ui-surface-unavailable`：required surface 没有可用 provider；
- `ui-mode-unsupported`：surface 不支持请求的 content mode；
- `ui-descriptor-invalid`：descriptor 不符合 surface schema；
- `ui-placement-conflict`：placement 或 single/keyed cardinality 冲突；
- `ui-owner-inactive`：registration owner 已不再 active；
- `ui-module-incompatible`：local module 不符合 surface ABI 或 renderer compatibility；
- `ui-permission-denied`：所需 UI 或领域 permission 未授权；
- `ui-view-failed`：view factory、render 或 action 执行失败。

UI contribution 失败不得使 shell root、其他 facets 或无关 views 一并失效。Surface host SHOULD 为 local-module view 提供 error boundary；无法渲染时必须保留关闭或返回路径。

## 安全与隐私

Contribution 不因可见于 UI 就获得业务权限。Facet 必须单独声明并取得其使用的领域协议和 permission。

Shell 必须把 descriptor、远端文本、图标引用和 markup 当作不可信输入。Surface definition 必须限制资源大小、嵌套深度、字符串长度、更新频率和并发 view 数。

Secret、approval token、OAuth code、credential value 和未授权附件不能进入普通 descriptor、view persistence、diagnostic 或 provenance record。Local module 取得 secret input 时必须通过 Presentation 或专门 Credential 协议的 scoped result，不能读取 shell 的其他 component state。

Static UI metadata 可以供安装器展示，但不能作为 runtime support、permission grant 或 handler 存在的证明。只有 active agreement 与成功 registration 构成可用 contribution。

## 兼容性

Base UI envelope 与每个 surface protocol 独立版本化：

- 新增一个可选 surface support 不改变已有 agreements；
- 修改 descriptor、action、state codec、cardinality 或 local-module ABI 时必须升级对应 surface coordinate；
- Shell 不理解 required surface 时不得激活该 facet；
- Shell 不理解 optional surface 时可以省略相关 registration，并提供可诊断的 unavailable 状态；
- 未知 static `UiContribution` surface 不能被渲染为“最佳猜测”UI；
- Profile 更换可以产生不同 UI facet plan，但不得改变未重新 composition 的 Host facet authority。

Manifest schema、surface definition、adapter mapping 和 conformance claim 必须分别声明所支持的版本。声明支持 `ui.dsh/v1alpha1 ContributionHost` 不表示支持任意产品或 shell 定义的 surface protocols。

## 与其他协议的关系

- Core 声明并协商 `ContributionHost` 与 surface coordinates；
- Manifest 描述 facets、activation、requirements 和可选静态 extensions；
- Composition 按当前 profile 选择 UI facets 并解决 required surfaces 与冲突；
- Lifecycle 提供 activation owner、publication barrier 和 cleanup scope；
- Permission 决定 facet 能否注册或调用受保护 surface；
- Presentation 处理 invocation-scoped open、copy、notification、question、approval 和 secret input；
- Command、Agent、Workspace、Session、Tool、Model 与 Settings 等协议提供 view 使用的业务数据和 action；
- Connection 承载已经由具体 surface 明确定义的远端数据消息，不承载 local module。

## 设计选择

### 不以静态 Manifest 枚举所有 UI

Profile-specific facet 已经是代码选择和 lifecycle owner。要求它把内部每个 view registration 再复制成静态 extension 会产生两份容易漂移的事实来源。只有需要 preflight、安装前展示、冲突规划或 policy 审批的 surface 才要求静态 descriptor。

### 不把产品 slot 名称写入 base protocol

Slot 是 shell 内部 composition API。Surface definition 可以稳定映射某个 slot，但 base envelope 只识别 surface coordinate、owner 和 descriptor。不同 shell 可以独立演进布局，不需要伪装成相同 slot tree。

### 不统一虚拟 UI tree

通用 tree 会绑定 renderer 语义，并把 accessibility、navigation、terminal cell layout 和 browser interaction 压缩为最低公分母。Host-rendered descriptor 只覆盖明确的 surface；复杂本地 UI 使用 local-module ABI。

### 不把长期 UI 放入 Presentation

Presentation request 属于一次 invocation，没有持久 contribution identity、placement、view state 或 facet cleanup。UI contribution 可以在 action 中调用 Presentation，但不能用 Presentation operation 冒充长期 view registration。

### 不传输远端可执行模块

远端 module 无法继承本地 shell 的 trust、renderer identity、dependency graph 和 permission principal。跨端复用应复用领域协议和可校验数据，而不是复制前端执行环境。
