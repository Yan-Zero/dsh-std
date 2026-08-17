# 设计提案

本目录收录 DSH Standard 的设计提案。提案没有编号；状态和日期记录在各文件开头。

状态含义：

- **方向已确认，接口/格式草案**：职责边界已经确认，具体对象、API 或文件格式仍可修改；
- **草案**：正在设计，尚未接受为稳定方向；
- **探索性草案**：先记录问题和候选边界，不表示将创建同名标准包。

## 元协议

| 组件 | 提案 | 状态 |
| --- | --- | --- |
| `@dsh-std/core` | [Core Meta-protocol](core.zh.md) | 方向已确认，接口草案 |

Core 只负责可拔插协议的声明与协商。其他提案可以使用 core，但不是 core 的固定子模块。

## 组件系统

| 组件 | 提案 | 状态 |
| --- | --- | --- |
| `@dsh-std/manifest` | [Static Component Manifest](manifest.zh.md) | 方向已确认，格式草案 |
| `@dsh-std/composition` | [Composition and Activation Planning](composition.zh.md) | 探索性草案 |
| `@dsh-std/lifecycle` | [Component Lifecycle](lifecycle.zh.md) | 探索性草案 |
| `@dsh-std/events` | [Event Points and Interception](events.zh.md) | 探索性草案 |
| `@dsh-std/permission` | [Permission Requests and Grants](permission.zh.md) | 探索性草案 |
| `@dsh-std/sdk` | [Scoped TypeScript SDK](sdk.zh.md) | 探索性草案 |

程序可以实现 core/connection 等协议而不采用这套插件组件模型。

## 领域协议

| 组件 | 提案 | 状态 |
| --- | --- | --- |
| `@dsh-std/connection` | [Connection Service and Endpoint Protocol](endpoint-connection.zh.md) | 方向已确认，接口草案 |
| `@dsh-std/connection/wire` | [CBOR Connection Wire Profile](connection-wire.zh.md) | 草案 |
| `@dsh-std/agent` | [Agent Control and Configuration](agent.zh.md) | 草案 |
| `@dsh-std/workspace` | [Workspace Catalog and Session Membership](workspace.zh.md) | 草案 |
| `@dsh-std/content` | [Content References and Transfer](content.zh.md) | 草案 |
| `@dsh-std/command` | [Command Resources and Runtime](command.zh.md) | 草案 |
| `@dsh-std/storage` | [Local Component Storage](storage.zh.md) | 草案 |
| `@dsh-std/messages` | [Message Observation](message-observer.zh.md) | 草案 |
| `@dsh-std/model` | [Model Provider Catalog](model.zh.md) | 草案 |
| `@dsh-std/tool` | [Tool Discovery](tool.zh.md) | 草案 |
| `@dsh-std/session` | [Session Catalog, History and Events](session.zh.md) | 草案 |
| `@dsh-std/presentation` | [Presentation Operations](presentation.zh.md) | 草案 |
| `@dsh-std/ui` | [UI Contributions](ui-contribution.zh.md) | 探索性草案 |
| `tui.dsh/v1alpha1` | [TUI Decision Events](tui-decision-events.zh.md) | 探索性草案 |

领域协议独立版本化。实现其中一项不表示实现其他项。

## 实现与质量

| 组件 | 提案 | 状态 |
| --- | --- | --- |
| `@dsh-std/adapter-dsh` | [DeepSeek Harness Adapter](adapter-dsh.zh.md) | 草案 |
| Conformance | [Conformance and Validation](conformance.zh.md) | 探索性草案 |
| Provenance | [Impact and Ownership Records](provenance.zh.md) | 探索性草案 |

Adapter 是产品实现，不是可移植协议。Conformance 与 provenance 的包名在参考实现验证前暂不确定。

`dsh-std` 不在表中。该包只占用无 scope 的 npm 名称，不提供协议或运行时 API。
