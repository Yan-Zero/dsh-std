# @dsh-std/connection

[English](README.md) | 中文

拟议设计见 [Endpoint Connection](../../docs/proposals/endpoint-connection.zh.md)。规范把普通应用使用的 `ConnectionService` 与 Connection Host 的 provider SPI 分开；本页其余内容描述尚未完成该分层的当前参考实现。

DSH Standard 的宿主通信 service、双端点能力协商与实现无关调用。

## 端点提议

端点提议包含端点身份、修订号，以及经端点 policy 裁剪后的 live participant declarations。它不携带 component manifests、安装记录或插件注册表。

`resolveConnection()` 把两端 declarations 交给调用方提供的 `ProtocolCatalog`。每份协议 definition 决定如何协商，并可在 agreement 中产生调用绑定；connection 不为所有协议预设 consumer/provider 语义。内置的 `defineCapabilityProtocol()` 是需要 RPC 绑定的领域协议可显式采用的辅助定义。

每项调用绑定都限定于消费 participant 和方案修订版。一个 participant 的客户端不能发现或调用授予另一 participant 的绑定。

## 当前参考 API

`StandardConnection` 暴露端点身份、当前方案、按消费方隔离的客户端、方案变更观察与关闭操作。`CapabilityClient.invoke()` 返回调用 id、结果 Promise、异步进度流与取消操作。领域协议包拥有操作名称以及输入、输出和进度值的语义。

`ConnectionBroker` 根据与实现无关的目标 URI，从已注册 `ConnectionConnector` 中选择唯一实现。零个匹配与多个匹配都是明确错误。broker 不会通过 `StandardConnection` 暴露选中的 connector 类型。

这些类型是早期参考实现，不表示 TUI、Web、GUI 或业务插件应自行注册 connector。规范方向是由 Connection Host 把 broker、connector/provider、carrier 和 wire 封装为 `ConnectionService`；consumer 只提交 target，并通过 scoped typed client 使用已协商协议。

Connection Host 负责安装或发现远端服务、认证、端口与转发、重连和 `StandardConnection`。SSH target facet 可以贡献解析与 bootstrap 集成，物理 SSH 则可由系统 OpenSSH 或独立 provider 完成。应用不会看到所选 provider、端口、凭据或 wire。

## 生命周期

重新协商会生成完整的新方案修订版，并原子发布。旧修订版已经接纳的调用保留其绑定直至结束；后续调用使用新修订版。关闭连接会取消活跃工作，并以 `connection-closed` 拒绝新工作。

传输实现必须保持调用隔离、进度顺序、取消语义和 `ConnectionInvocationError` 暴露的错误分类。实现还负责认证对端，并阻止一条连接复用另一条连接的授权。

## 参考实现

`@dsh-std/connection/memory` 导出用于测试、适配器和一致性实验的进程内实现。它演示双向调用、进度、取消、隔离和重新协商，但不是强制承载方式或线协议规范。

## 已知限制与暂缓事项

- consumer-facing `ConnectionService` 与 Host provider SPI 尚未在当前代码中实现。
- 本包尚未标准化发现、认证、加密、重连策略、封帧或序列化。
- `v1alpha1` 的一条连接恰好包含两个端点；多方路由由多条独立连接组合。
- Capability helper 默认要求唯一对端提供方；需要多提供方的协议必须明确选择其规则。
