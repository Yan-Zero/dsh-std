# @dsh-std/adapter-dsh

[English](README.md) | 中文

DeepSeek Harness 的产品适配层。设计见 [DeepSeek Harness Adapter](../../docs/proposals/adapter-dsh.zh.md)。Cordis、Typert、Agent 与 DSH command registry 的类型止于此包。

`DshStandardAdapter` 持有协议 definition catalog、manifest definition catalog、activation drivers、lifecycle coordinator 和 connection endpoint。它不是全局插件注册表。

这个包自身是 DSH profile bundle；安装后由 `cordis.patch.yml` 激活。adapter 会读取当前 profile 的普通 dependencies，发现并校验其中的 Community v0.15 `dsh-plugin.json`，协商 `requires.contracts`，再装载 `facets.host.entry`。标准插件本身不需要声明 `dsh.bundle`，也不需要引用这个 adapter。

在具备 browser surface 的 profile 中，adapter 自己的 DSH browser half 会读取标准 `browser.ui.dsh/v1alpha1 LocalModule` 声明，提供 package 内的模块产物，并通过 DSH `0.1.2-alpha.2` 的 API Gateway、Session Controller、client module system 与 Cordis lifecycle 激活。组件不需要 Cordis 根 Loader entry，也不需要 `dsh.client` metadata。TUI 与 headless profile 不会装载这些模块；仅 browser transport 与 UI peer 为 optional，Host adapter 则要求 `sessionController` 服务。

Browser half 实现可选的 `@dsh-std/ui-browser` `SettingsSection` 与 `ToolCallView` surfaces。它用 `slots.inject()` 等待对应的原生 slot，通过协商为 browser-realm facet 签发 activation-scoped `ui.dsh/v1alpha1 ContributionHost`，并在 facet 卸载时撤销全部 slot registration。组件只导入 surface 协议包，不导入本 adapter；原始 DSH slot 名保留在 adapter 内。DSH 的“插件”页会增加独立的“标准组件”清单，显示标准 lifecycle 状态，而不会伪造 Cordis Loader row。

命令始终可以通过标准 `CommandRuntime` 执行。产品 UI 只有为精确 placement 坐标注册 provider 后，才会把匹配的命令投影到原生命令 registry。Web、Desktop、TUI 或其他 shell 不构成协议内置分类。

Host 需要先发布内建 participant 时，可以用 `discover: false` 只启动 adapter core，并在这些 publication 就绪后挂载 `@dsh-std/adapter-dsh/profile-loader`。后者只执行 profile component discovery 与 activation，不会创建第二个 adapter。

```sh
dsh plugin --profile web add @dsh-std/adapter-dsh
dsh plugin --profile web add <standard-component>
```

其他宿主也可以直接调用 `mount()`，但模块解析和产品服务映射属于宿主 adapter 的职责；它们不进入标准组件。

Entrypoint 在激活期间通过 `context.protocols.implement()` 与 `context.extensions.publish()` 暂存事实。只有激活成功、静态范围校验及协议协商通过后，它们才越过 publication barrier，进入 live publication 与 connection offer。激活失败或卸载会按 activation instance owner 撤销全部结果。

当前 DSH 映射实现 `CommandRuntime`、`ModelCatalog`、`SessionCatalog` 的 list/get/create/rename、`SessionHistory` 的 read/follow、本地 `Tool` / `ToolOverride` activation 与 browser-local UI contribution，并在协议目录中装载 `MessageObserver`、`LocalStorage` 与 Presentation definitions。Session descriptor 与 history 来自 `sessionController` 的 cold-safe list/inspect/follow seam；adapter 不宣称 DSH 尚未提供同等删除、watch 或幂等 fork 语义的 operation。DSH 原生 event 对 portable reader 标记为 ignorable，标准组件声明的 `SessionEvent` 则保留其 replay 分类。

工具函数不会穿过 connection endpoint；adapter 把它们注册进 DSH 原生 registry，并在每次已接受调用中提供 DSH 的模型、附件、filesystem observed、write-intent、sandbox 与嵌套 context 语义。装载 definition 不会发布相应 support；只有实际 Host participant 越过 publication barrier 后，required contract 才能协商成功。命令和模型目录只使用 active facet 已发布的 extension，并保留 component、facet、participant provenance。Adapter 不会把 Presentation 操作序列化到命令结果；当前 agreement 的类型化 client 必须由 Connection Host 按 invocation scope 提供。

Typert 只是 DSH 当前暴露 adapter service 的方式，不是 `@dsh-std/connection` 的线协议要求。
