# @dsh-std/adapter-dsh

[English](README.md) | 中文

DeepSeek Harness 的产品适配层。设计见 [DeepSeek Harness Adapter](../../docs/proposals/adapter-dsh.zh.md)。Cordis、Typert、Agent 与 DSH command registry 的类型止于此包。

`DshStandardAdapter` 持有协议 definition catalog、manifest definition catalog、activation drivers、lifecycle coordinator 和 connection endpoint。它不是全局插件注册表。

这个包自身是 DSH profile bundle；安装后由 `cordis.patch.yml` 激活。adapter 会读取当前 profile 的普通 dependencies，发现其中的 `manifest.yaml`，解析并校验使用 `lifecycle.dsh/v1alpha1 FacetModule` activation 的 facet，再通过 `mount()` 激活。标准组件本身不需要声明 `dsh.bundle`，也不需要引用这个 adapter。

```sh
dsh plugin --profile web add @dsh-std/adapter-dsh
dsh plugin --profile web add <standard-component>
```

其他宿主也可以直接调用 `mount()`，但模块解析和产品服务映射属于宿主 adapter 的职责；它们不进入标准组件。

Entrypoint 在激活期间通过 `context.protocols.implement()` 与 `context.extensions.publish()` 暂存事实。只有激活成功、静态范围校验及协议协商通过后，它们才越过 publication barrier，进入 live publication 与 connection offer。激活失败或卸载会按 activation instance owner 撤销全部结果。

当前 DSH 映射实现 `CommandRuntime` 与 `ModelCatalog`。命令和模型目录只使用 active facet 已发布的 extension，并保留 component、facet、participant provenance。表现操作仍是 invocation-scoped：facet 必须声明相应 presentation requirement，当前客户端也必须提供它。

Typert 只是 DSH 当前暴露 adapter service 的方式，不是 `@dsh-std/connection` 的线协议要求。
