# @dsh-std/adapter-dsh

[English](README.md) | 中文

DeepSeek Harness 的产品适配层。设计见 [DeepSeek Harness Adapter](../../docs/proposals/adapter-dsh.zh.md)。Cordis、Typert、Agent 与 DSH command registry 的类型止于此包。

`DshStandardAdapter` 持有协议 definition catalog、manifest definition catalog、activation drivers、lifecycle coordinator 和 connection endpoint。它不是全局插件注册表。

这个包自身是 DSH profile bundle；安装后由 `cordis.patch.yml` 激活。adapter 会读取当前 profile 的普通 dependencies，发现并校验其中的 Community v0.15 `dsh-plugin.json`，协商 `requires.contracts`，再装载 `facets.host.entry`。标准插件本身不需要声明 `dsh.bundle`，也不需要引用这个 adapter。

在 Web profile 中，同一个包还通过 `dsh.client` 提供普通 DSH browser half。Host discovery 只有在原生 `clientModules` service 已经存在，并且组件声明了 `dsh.client.platform: "web"` 时，才会挂载该组件的 browser half。TUI 与 headless profile 会在读取、装载 browser metadata 之前返回；全部 Web peer 也是 optional。

Browser half 持有 DSH 专属的 `SettingsSection` 与 `ToolCallView` surfaces。它用 `slots.inject()` 等待对应的原生 slot，通过协商为 Web facet 签发 activation-scoped `ui.dsh/v1alpha1 ContributionHost`，并在 facet 卸载时撤销全部 slot registration。组件通过 `@dsh-std/adapter-dsh/client` 的 `defineDshWebUiFacet()` 接入；原始 slot 名与 Cordis context 不进入可移植 UI 代码。

Host 需要先发布内建 participant 时，可以用 `discover: false` 只启动 adapter core，并在这些 publication 就绪后挂载 `@dsh-std/adapter-dsh/profile-loader`。后者只执行 profile component discovery 与 activation，不会创建第二个 adapter。

```sh
dsh plugin --profile web add @dsh-std/adapter-dsh
dsh plugin --profile web add <standard-component>
```

其他宿主也可以直接调用 `mount()`，但模块解析和产品服务映射属于宿主 adapter 的职责；它们不进入标准组件。

Entrypoint 在激活期间通过 `context.protocols.implement()` 与 `context.extensions.publish()` 暂存事实。只有激活成功、静态范围校验及协议协商通过后，它们才越过 publication barrier，进入 live publication 与 connection offer。激活失败或卸载会按 activation instance owner 撤销全部结果。

当前 DSH 映射实现 `CommandRuntime`、`ModelCatalog`、本地 `Tool` / `ToolOverride` activation 与 browser-local UI contribution，并在协议目录中装载 `MessageObserver`、`LocalStorage` 与 Presentation definitions。工具函数不会穿过 connection endpoint；adapter 把它们注册进 DSH 原生 registry，并在每次已接受调用中提供 DSH 的模型、附件、filesystem observed、write-intent、sandbox 与嵌套 context 语义。装载 definition 不会发布相应 support；只有实际 Host participant 越过 publication barrier 后，required contract 才能协商成功。命令和模型目录只使用 active facet 已发布的 extension，并保留 component、facet、participant provenance。Adapter 不会把 Presentation 操作序列化到命令结果；当前 agreement 的类型化 client 必须由 Connection Host 按 invocation scope 提供。

Typert 只是 DSH 当前暴露 adapter service 的方式，不是 `@dsh-std/connection` 的线协议要求。
