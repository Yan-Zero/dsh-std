# `@dsh-std/session`

本包定义 provider-scoped Session identity 和三个可独立使用的协议面。`SessionCatalog` 列出并管理 descriptor，`SessionHistory` 读取、跟随和 fork 持久历史，`SessionEvent` 声明一种由组件拥有的持久事件类型。

Catalog 与 History 是分离的 capability，因此元数据访问不会授予历史访问。Workspace membership 仍由 `@dsh-std/workspace` 拥有；Session create 和 fork 不隐式 attach Workspace。

本包不是全局事件总线。持久 Session fact 只有一个观察面：带 provider cursor 和 replay 语义的 `SessionHistory.read()` / `follow()`。普通 History client 不能任意 append event。
