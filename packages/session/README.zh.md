# `@dsh-std/session`

本包定义会话领域的静态扩展。`SessionEvent` 声明一种由组件拥有的持久事件类型；产品 adapter 将该声明注册到实际的会话存储实现，并将注册的生命周期绑定到 facet owner。

它不定义通用事件总线。观察和拦截运行中操作仍属于 `@dsh-std/events`；事件的持久化、重放与未知类型处理属于 session 领域。
