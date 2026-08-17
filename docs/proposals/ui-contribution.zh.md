# `@dsh-std/ui` Contribution 设计提案

- 文档类型：设计提案
- 状态：探索性草案
- 日期：2026-08-16

## Summary

`@dsh-std/ui` 定义组件如何向一个 UI shell 声明持久 contribution，以及 shell 如何协商、选择和管理这些 contribution。

UI contribution 与 `@dsh-std/presentation` 不同：presentation operation 属于一次 invocation；UI contribution 在所属 facet 被选中且其所需 handler active 期间存在，可以形成页面、面板、列表项或其他 shell-owned surface。

本提案不规定统一 widget toolkit，也不要求 TUI、Web、GUI 和编辑器渲染同一棵组件树。

## Motivation

把 UI 扩展直接写成 React、DOM、Ink 或编辑器 API 会让插件依赖某个前端。反过来设计一个覆盖所有 UI 的通用组件模型，容易成为最小公分母且无法忠实表达各 shell 的交互。

需要一个更小的公共边界：

- contribution 有稳定 identity 与 owner；
- shell 声明自己理解哪些 contribution protocols；
- manifest 可以在不执行代码时展示 UI 影响；
- composition 可以检查 placement 和独占冲突；
- lifecycle 可以在插件停用时移除 UI；
- Web/TUI-specific 内容仍由各自协议定义。

## Guide-level explanation

Facet 在 manifest 中加入 `UiContribution` extension：

```json
{
  "apiVersion": "ui.dsh/v1alpha1",
  "kind": "UiContribution",
  "metadata": { "name": "example.sessions" },
  "spec": {
    "surface": {
      "apiVersion": "ui.web.dsh/v1alpha1",
      "kind": "Route"
    },
    "placement": "workspace",
    "content": {
      "path": "/sessions"
    }
  }
}
```

Web shell 可以实现 `ui.web.dsh/Route`，TUI 可以实现自己的 screen 或 command palette contribution。插件若希望支持两种 shell，可以提供两项独立 contribution，或采用双方都实现的一份更高层领域 UI protocol。

Shell 只激活自己声明支持、composition 接纳且 permission 允许的 contribution。

## Reference-level explanation

### Contribution envelope

UiContribution 外壳包含全局稳定 id、surface protocol reference、placement 和 surface-owned content。

`surface` 决定 content schema、实例化方式、可用 placement 和交互消息。`@dsh-std/ui` 不解释 React component、HTML、Ink node 或其他 renderer object。

### Shell declaration

UI shell 通过 core declaration 发布所支持的 surface protocols 及限制，例如可用 placement、最大 contribution 数或是否允许远端内容。

Composition 调用 surface definition，把 manifest contributions 与 shell support 组合为 UI plan。多个 contribution 的排序、独占区域和 selector 由 surface definition决定，不按加载顺序处理。

### Local and remote contributions

安装在 shell 本地且被选中的 facets 可以参与本地 UI composition。远端 endpoint 的 manifest 不会因 connection 建立而自动注入本地 UI。

需要远端 UI contribution 时，双方必须协商 UI catalog protocol。该协议只传输经过 peer policy 允许、schema 校验且可安全序列化的 contribution。远端不能发送可执行 JavaScript、DOM node 或本地模块路径。

### State

Shell 拥有 view instance 的运行状态。Contribution 可以声明可序列化的初始 state schema和 shareable-state codec；实际存储位置由 shell 决定。

状态是否可以分享、如何编码以及由 shell 还是 surface protocol 保存，尚未确定。包含凭据、approval token、device code 或私有输入的字段不能进入普通 session persistence。

### Lifecycle and ownership

每个 view instance 关联 contribution owner、shell instance 和 composition plan revision。Component 停用或 UI plan 替换时，shell 关闭对应 view 并清理订阅。

UI contribution 不赋予插件访问 shell root、其他 component view 或任意 workspace 数据的权限。数据访问通过单独协议与 permission grant 完成。

### Presentation relationship

一次命令请求打开网页、复制文本或显示通知属于 presentation operation。向 shell 添加长期存在的模型页面或远端连接面板属于 UI contribution。

UI view 可以在用户操作时调用 presentation 或其他协议，但必须使用当前 view instance 获得的 scoped client。

## Security considerations

Shell 不执行来自远端 contribution 的代码。Surface protocol 若允许本地 executable activation，加载器仍需按 manifest、provenance、permission 和 sandbox policy 验证。

如果后续定义 shareable state，只能包含 surface definition 明确标记且经过 codec 校验的字段。默认状态不可分享。

## Drawbacks

同一功能可能需要分别实现 Web 与 TUI contribution。公共领域协议可以复用数据和操作，但无法保证界面代码本身复用。

Surface protocol 数量会增长，需要 shell 清楚声明支持集合，并为未知 surface 提供可理解的诊断。

## Rationale and alternatives

### 统一虚拟 UI tree

统一 tree 会限制各 shell 的 navigation、accessibility 和交互能力，并把 renderer 版本耦合到标准。UI 标准只统一 contribution 外壳和协商。

### 直接传前端模块

远端模块不可安全地注入本地 shell，也使 TUI/Web 实现互相依赖。远端只发送对应 surface protocol 允许的声明数据。

### 把长期 UI 放入 presentation

Presentation 是 invocation-scoped operation，没有 owner、placement 和持久 view lifecycle。两者采用不同协议。

## Unresolved questions

### First surface protocols

需要从实际 Web、TUI 和编辑器扩展中选择首批 surface。提案暂不虚构一套通用 panel/route/menu 枚举。

### UI catalog

远端 contribution 的 catalog、增量更新和 view message 是否属于 `@dsh-std/ui` 主协议，还是独立连接 profile，需结合 Host/TUI 实现验证。
