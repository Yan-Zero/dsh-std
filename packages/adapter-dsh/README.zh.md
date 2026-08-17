# @dsh-std/adapter-dsh

[English](README.md) | 中文

DeepSeek Harness 的产品适配层。设计见 [DeepSeek Harness Adapter](../../docs/proposals/adapter-dsh.zh.md)。Cordis、Typert、Agent 与 DSH command registry 的类型止于此包。

`DshStandardAdapter` 持有协议 definition catalog、manifest definition catalog、activation drivers、lifecycle coordinator 和 connection endpoint。它不是全局插件注册表。

DSH loader 发现并校验 `manifest.yaml` 后，只把 composition 选中的 facet 交给 `mount()`。Facet 必须使用 `adapter.dsh/v1alpha1 CordisEntrypoint` activation；loader 负责解析模块，adapter 负责为 entrypoint 创建受限 `ActivationContext`。

Entrypoint 在激活期间通过 `context.protocols.implement()` 与 `context.extensions.publish()` 暂存事实。只有激活成功、静态范围校验及协议协商通过后，它们才越过 publication barrier，进入 live publication 与 connection offer。激活失败或卸载会按 activation instance owner 撤销全部结果。

当前 DSH 映射实现 `CommandRuntime` 与 `ModelCatalog`。命令和模型目录只使用 active facet 已发布的 extension，并保留 component、facet、participant provenance。表现操作仍是 invocation-scoped：facet 必须声明相应 presentation requirement，当前客户端也必须提供它。

Typert 只是 DSH 当前暴露 adapter service 的方式，不是 `@dsh-std/connection` 的线协议要求。
