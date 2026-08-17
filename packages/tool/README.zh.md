# @dsh-std/tool

[English](README.md) | 中文

拟议设计见 [Tool Discovery](../../docs/proposals/tool.zh.md)。

面向模型工具的运行时发现协议。

## 协议

一项 `Tool` 资源声明标题、本地化标题和目录说明。运行时拥有的 status 报告工具处于 `available` 还是 `unavailable`。可用工具可以投影解析后的模型说明和惰性 JSON Schema 参数；不可用工具可以说明无法使用的原因。

静态 extension 记录其 component 与 facet owner，status 回答当前运行时组合实际能够暴露什么。这个区分支持渐进式披露，同时不会声称所有已安装工具都已激活，也不会跨端点传输可执行校验器。

该协议只描述发现。工具调用、流式输出、审批、沙箱策略和模型记录语义仍归运行时或其他独立协议包所有。

## 已知限制与暂缓事项

- `v1alpha1` 不定义跨运行时工具调用操作。
- JSON Schema 作为惰性数据传输；消费方自行选择校验器和支持的方言。
- UI 渲染提示与结果附件不属于此资源族。
