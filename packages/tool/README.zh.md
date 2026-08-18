# @dsh-std/tool

[English](README.md) | 中文

拟议设计见 [Tool Discovery](../../docs/proposals/tool.zh.md)。

面向模型工具的运行时发现协议与本地同进程执行接缝。

## 协议

一项 `Tool` 资源声明标题、本地化标题和目录说明。运行时拥有的 status 报告工具处于 `available` 还是 `unavailable`。可用工具可以投影解析后的模型说明和惰性 JSON Schema 参数；不可用工具可以说明无法使用的原因。

静态 extension 记录其 component 与 facet owner，status 回答当前运行时组合实际能够暴露什么。这个区分支持渐进式披露，同时不会声称所有已安装工具都已激活，也不会跨端点传输可执行校验器。

已激活 facet 可以在 `Tool` resource 旁发布 `ToolHandler`。Handler 解析出可移植的可执行定义，由同进程 adapter 映射到产品原生工具目录。执行上下文中的模型能力、图片校验与附件、带 observed 语义的 workspace 读取、经过写入策略的 workspace 写入、嵌套内容延迟，以及 override 对原工具的委托，均由宿主提供；组件无需绕过或重复实现宿主 policy 与持久记录语义。

这里特意不定义跨 runtime 调用协议：函数与字节缓冲区只存在于同一进程的 activation 中。流式输出、审批、工具调用传输和模型记录所有权仍归 runtime。

## 已知限制与暂缓事项

- `v1alpha1` 不定义跨运行时工具调用操作；可执行 handler 是本地 activation value。
- JSON Schema 作为惰性数据传输；消费方自行选择校验器和支持的方言。
- UI 渲染提示不属于此资源族。本地结果可以引用宿主管理的图片附件，而不把图片字节塞入 JSON。
