# 包

[English](README.md) | 中文

每个包拥有提案中一个可独立版本化的部分。消费方应依赖定义其所用行为的最小包。

| 包 | 职责 | 是否依赖具体产品 |
|---|---|---|
| [`@dsh-std/core`](core/README.zh.md) | 协议声明、definition 注册与协商元协议 | 否 |
| [`@dsh-std/manifest`](manifest/README.zh.md) | `dsh-plugin.json` 草案清单、schema 与静态校验 | 否 |
| [`@dsh-std/composition`](composition/README.zh.md) | Facet 选择、静态 preflight 与组合计划 | 否 |
| [`@dsh-std/lifecycle`](lifecycle/README.zh.md) | Activation instance、cleanup 与 publication barrier | 否 |
| [`@dsh-std/sdk`](sdk/README.zh.md) | TypeScript facet 与 typed protocol helper | 否 |
| [`@dsh-std/command`](command/README.zh.md) | 声明式用户命令树 | 否 |
| [`@dsh-std/ui-browser`](ui-browser/README.md) | 可选的 browser-realm UI surface 与 module ABI | 否 |
| [`@dsh-std/storage`](storage/README.zh.md) | Component 私有 JSON 键值存储 | 否 |
| [`@dsh-std/messages`](messages/README.zh.md) | 只读消息观察事件 | 否 |
| [`@dsh-std/model`](model/README.zh.md) | ModelProvider 资源与共享 ModelCatalog | 否 |
| [`@dsh-std/tool`](tool/README.zh.md) | 工具发现与实时可用性 | 否 |
| [`@dsh-std/presentation`](presentation/README.zh.md) | 调用作用域内面向用户的操作 | 否 |
| [`@dsh-std/connection`](connection/README.zh.md) | 端点协商与实现无关的调用 | 否 |
| [`@dsh-std/adapter-dsh`](adapter-dsh/README.zh.md) | DeepSeek Harness 与 Cordis 集成 | 是 |
| [`dsh-std`](namespace-guard/README.zh.md) | 无 scope npm 名称占位 | 无运行时 API |

协议包可以依赖 `@dsh-std/core`；需要 RPC 形状时可以显式采用 `@dsh-std/connection` 的 capability helper。它们不得依赖产品适配器。适配器可以依赖自己需要映射到产品中的协议包。
