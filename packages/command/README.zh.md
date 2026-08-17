# @dsh-std/command

[English](README.md) | 中文

拟议设计见 [Command Resources and Runtime](../../docs/proposals/command.zh.md)。

具名用户命令资源及其共享的可调用 Runtime 分派器。

## 协议

一项 `Command` 资源描述一个根命令及其嵌套子命令。节点可以提供标题、本地化标题、说明、别名、位置参数、选项和子节点。参数可以是必需、可变长或受已声明值限制；选项声明全部字面拼写，并可接收一个值。

`CommandRuntime` 为全部命令 extension 统一定义 `catalog` 与 `execute` 操作。运行时适配器把 active facets 发布的 extension 与自身权威命令注册表关联，并实现该能力。执行上下文 id 对标准保持不透明；DSH 适配器将其映射为会话。结果只包含命令结果；调用作用域内的 UI 操作使用 `@dsh-std/presentation` 的类型化 client。

`commandRuntime()` 用类型化方法包装按消费方隔离的 `CapabilityClient`，`commandRuntimeImplementation()` 为适配器创建操作分派器。消费方与适配器都无需重复操作字符串或载荷校验。

表现客户端无需导入所属 component，即可构建补全树和表单。dsh-codex 之类的 component 声明 `Command/codex`，由选中的 facet 在本地运行时发布 handler；它不定义 connection 专用方法。

名称与别名必须是单个 token。同级名称与别名、参数名、选项拼写和枚举值必须唯一。可变长参数必须位于末尾。

## 扩展点

以 `x-` 开头的字段可以承载实验性元数据。可移植客户端忽略无法理解的扩展。不兼容的命令语义需要新的协议主版本，不能重新定义现有字段。

## 已知限制与暂缓事项

- 协议不定义命令行解析器或引号规则。
- `v1alpha1` 不包含动态补全；已声明值是静态的。
