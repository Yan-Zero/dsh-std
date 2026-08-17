# @dsh-std/model

[English](README.md) | 中文

拟议设计见 [Model Provider Catalog](../../docs/proposals/model.zh.md)。

具名模型提供方资源及用于发现这些资源的共享目录。

## ModelProvider 资源

一项 `ModelProvider` 资源表示一个已安装的模型集成，例如 OpenAI Codex、Anthropic 或 DeepSeek。其静态 spec 包含显示标题，以及用于认证、登出和配置的可选结构化 `CommandReference`。引用指向一个 `Command` 资源及其命令路径，不是可执行回调，也不是编码后的命令行。

运行时拥有的 status 区分 `ready`、`authentication-required` 与 `unavailable`。它还发布提供方内部的模型 id、名称、说明、明确的可选择状态及可选原因。Extension 缺失表示当前没有 active facet 发布该提供方；已发布的提供方仍可以独立报告需要认证。

`ModelProvider` 不是 connection 注册表中的 capability provider。Facet 可以为该 resource 发布 `ModelProviderHandler`；handler 通过标准 message、tool schema、attachment reader 和 stream chunk 完成本端推理，产品 adapter 负责与自身模型 registry 的转换。

## ModelCatalog 能力

`ModelCatalog` 是由运行时适配器实现一次的调用协议。其 `list` 与 `get` 操作暴露全部活跃 `ModelProvider` extensions，以及 component、facet、participant 和运行时状态。因此，多个提供方以不同具名 extension 共存，而 connection 协商只看到一个无歧义的目录实现。

`modelCatalog()` 提供类型化 connection 客户端，`modelCatalogImplementation()` 创建适配器侧分派与校验。模型插件和表现客户端都不定义自己的 connection 方法。

模型 component 声明 provider extension，并发布 handler。它不导入产品 adapter，也不定义 connection 专用方法。当 agent 与模型集成位于同一端点时，产品 adapter 调用该 handler。

## 已知限制与暂缓事项

- `v1alpha1` 不标准化远端推理、模型选择变更、凭据、计费或配额。
- 目录操作提供当前快照，尚未定义变更订阅。
- 提供方管理流程通过 `Command` 资源引用，不在本 RFC 中重复定义。
