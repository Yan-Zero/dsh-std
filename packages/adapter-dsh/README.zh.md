# @dsh-std/adapter-dsh

[English](README.md) | 中文

DeepSeek Harness 的产品适配层。设计见 [DeepSeek Harness Adapter](../../docs/proposals/adapter-dsh.zh.md)。Cordis、Typert、Agent 与 DSH command registry 的类型止于此包。

`DshStandardAdapter` 持有协议 definition catalog、manifest definition catalog、activation drivers、lifecycle coordinator 和 connection endpoint。它不是全局插件注册表。

这个包自身是 DSH profile bundle；安装后由 `cordis.patch.yml` 激活。adapter 会读取当前 profile 的普通 dependencies，发现并校验其中的 Community v0.15 `dsh-plugin.json`，协商 `requires.contracts`，再装载 `facets.host.entry`。标准插件本身不需要声明 `dsh.bundle`，也不需要引用这个 adapter。

Host 需要先发布内建 participant 时，可以用 `discover: false` 只启动 adapter core，并在这些 publication 就绪后挂载 `@dsh-std/adapter-dsh/profile-loader`。后者只执行 profile component discovery 与 activation，不会创建第二个 adapter。

```sh
dsh plugin --profile web add @dsh-std/adapter-dsh
dsh plugin --profile web add <standard-component>
```

其他宿主也可以直接调用 `mount()`，但模块解析和产品服务映射属于宿主 adapter 的职责；它们不进入标准组件。

Entrypoint 在激活期间通过 `context.protocols.implement()` 与 `context.extensions.publish()` 暂存事实。只有激活成功、静态范围校验及协议协商通过后，它们才越过 publication barrier，进入 live publication 与 connection offer。激活失败或卸载会按 activation instance owner 撤销全部结果。

当前 DSH 映射实现 `CommandRuntime` 与 `ModelCatalog`，并在协议目录中装载 `MessageObserver`、`LocalStorage` 与 Presentation definitions。装载 definition 不会发布相应 support；只有实际 Host participant 越过 publication barrier 后，required contract 才能协商成功。命令和模型目录只使用 active facet 已发布的 extension，并保留 component、facet、participant provenance。Adapter 不会把 Presentation 操作序列化到命令结果；当前 agreement 的类型化 client 必须由 Connection Host 按 invocation scope 提供。

Typert 只是 DSH 当前暴露 adapter service 的方式，不是 `@dsh-std/connection` 的线协议要求。
