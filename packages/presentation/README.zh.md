# @dsh-std/presentation

[English](README.md) | 中文

拟议设计见 [Presentation Operations](../../docs/proposals/presentation.zh.md)。

运行时插件可以向已连接表现客户端请求的小型、调用作用域内操作。

## 协议

`v1alpha1` 定义三个彼此独立的表现协议：

- `OpenExternal` 请求客户端打开 HTTP 或 HTTPS URI；
- `CopyText` 请求客户端把文本复制到剪贴板；
- `Notification` 请求客户端显示信息、警告或错误文本。

Facet 在清单中声明每项所需操作。客户端只为当前连接声明自己能够执行的协议。仅当全部必需表现协议可用时，运行时才接纳命令；运行时也只接受该 facet 事先声明的操作。操作属于当前调用，不是全局事件总线或持久客户端能力。

本包只校验数据，不执行 UI 工作。原生应用、终端、浏览器、编辑器和自动化客户端可以实现不同子集。

## 已知限制与暂缓事项

- `OpenExternal` 有意拒绝非 HTTP(S) URI scheme。
- 协议不定义剪贴板读取、任意对话框、文件选择器或秘密输入。
- `v1alpha1` 不包含投递确认与持久回放。
