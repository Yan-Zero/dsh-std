# `@dsh-std/ui-browser` Browser-realm UI Surface 提案

- 文档类型：设计提案
- 状态：草案
- 日期：2026-08-18

## Summary

`@dsh-std/ui-browser` 定义可以在同一 JavaScript page realm 中装载的 UI module，以及 `SettingsSection`、`ToolCallView` 两项 browser-realm surface。它建立在 `@dsh-std/ui` 的 `ContributionHost` 之上，不改变基础 UI envelope。

本协议描述 surface 能力，不描述 profile 或应用类别。浏览器应用、Electron renderer、WebView 容器或其他 shell 只要实现相同 module ABI，均可发布这些 surface。没有同一 page realm 的 TUI、headless runtime 与 native UI 不需要实现本协议。

## Protocol coordinates

本协议使用 `browser.ui.dsh/v1alpha1`：

| Kind | Content mode | 用途 |
| --- | --- | --- |
| `SettingsSection` | `local-module` | 在设置导航与内容区域注册一项 view |
| `ToolCallView` | `local-module` | 为具名工具注册调用结果 view |
| `LocalModule` | activation | 在实现本 ABI 的 shell 中激活 UI facet |

坐标表示可协商能力。实现不得根据 `web`、`desktop`、`tui` 等 profile 名推断 support，也不得仅因运行于 Electron 或浏览器进程就声明 support。

## Local module activation

`LocalModule` facet 的 module 必须实现 `FacetModule`。Shell 在激活前对 facet requirements 执行 composition 与协议协商，并只向 activation context 提供已形成 agreement 的 client。

同一个 module 必须与 shell 的 renderer、framework instance 和 page realm 兼容。Module value 不得通过 Connection 传输；远端 endpoint 只能交换 descriptor、catalog 与其他可序列化数据。需要在本地呈现远端 runtime 状态时，consumer 端必须安装相符 module，并通过独立领域协议访问远端能力。

Activation instance 失活时，shell 必须撤销该 instance 注册的全部 contributions，取消未完成工作，并调用 facet cleanup。一个 facet 的失败不得移除其他 activation instance 的 view。

## `SettingsSection`

Descriptor content 包含：

```ts
interface SettingsSectionContent {
  readonly label: string
  readonly order?: number
}
```

`label` 是 shell 尚未建立本地化 binding 时使用的回退文字。`order` 是同一 settings surface 内的排序提示；最终冲突处理与布局由 surface owner 决定。

Local module value 必须提供 shell 可渲染的 component。可选 binding 可以提供 locale namespace、动态 label、dependency injection factory 与 disposer。Module 不能取得其他 settings section、root layout 或全局 renderer 的所有权。

## `ToolCallView`

Descriptor content 包含：

```ts
interface ToolCallViewContent {
  readonly tool: string
}
```

`tool` 是该 view 对应的标准或产品工具名称。多个 active contributions 指向同一工具时，surface owner 必须依据 composition policy 选择、拒绝或明确组合，不得以未声明的 activation 顺序静默覆盖。

Local module 只能渲染调用数据。工具执行、approval、policy 与结果的权威状态仍属于 Tool、Session 和 Presentation 等领域协议。

## Host services

Browser-realm module host 可以提供 locale binding、标准 command client 与经授权 content client。每项业务能力必须保持原领域协议的 identity、agreement、cancellation 与 permission；本协议不得以一个无界的 UI host object 替代 Command、Content、Session 或 Presentation 协议。

具体产品将其 slot、router、locale runtime 与 renderer 映射到本协议时，不得把这些产品 service name 写入 component manifest。产品 adapter 可以提供同 realm 的 loader service，但 component 只依赖本协议定义的 module host contract。

## Desktop and embedded shells

Desktop shell 若复用 browser client module graph 与相同 slots，可以声明本协议 support。这里声明的是 renderer ABI，不是产品类别。Desktop 仍可同时提供 native window、tray 或其他专属 surface；这些能力必须使用各自坐标声明。

Desktop shell 若使用不同 renderer ABI，必须定义不同坐标。两个 surface 都显示在图形界面中不构成兼容证据。

## Security and lifecycle

`local-module` 在 shell 进程和 page realm 中执行，本协议不提供隔离边界。实现必须把 descriptor 文本视为不可信数据，对 view 数量、更新频率、附件读取与资源占用施加限制。

Module 获得 surface registration 不等于获得 Command、Content、Session、Workspace、Filesystem、Network 或 Credential 权限。每项能力必须独立声明并协商。Cleanup 结束后，module 不得继续持有 slot、订阅、object URL、timer 或 product service lease。

## Compatibility

增加可选 descriptor 字段可以保持同一 alpha revision；改变 component ABI、binding lifecycle、surface cardinality或现有字段语义必须使用新的 `apiVersion` 或 kind。Shell 必须按精确坐标和 ABI revision 声明 support，不得用“支持图形界面”替代版本协商。
