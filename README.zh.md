# DSH Standard

[English](README.md) | 中文

DSH Standard 是一组可以按需实现、彼此独立版本化的协议，用于让 DSH 插件、运行时和用户界面互操作。

`@dsh-std/core` 是声明和协商其他协议的元协议。Connection、command、tool、presentation 等协议通过 core 被发现，但分别定义自己的语义；Host、TUI、Web、GUI 和其他程序可以只实现需要的部分。

协议包可以提供类型、校验器、协商算法、状态机或一致性测试作为参考实现。符合规范的实现不要求使用这些 TypeScript 包，也不要求依赖 DeepSeek Harness。

## 愿景：分层、可选、不强制

DSH Standard 采用三层结构：

```text
元协议（core）       只约定"如何声明与协商协议"，不预设领域概念，不定义固定角色
    │
独立领域协议         connection / command / tool / session / presentation / agent ...
    │                 彼此独立版本化，可独立实现、独立替换，可被未来新协议取代
    │
Profile            面向具体产品形态的准入与互操作规范，由生态项目承载
                     （如 dsh-ecosystem-spec 提供 TUI Profile）
```

- **本仓库不做任何强制规范**。全部协议可选、可替换；协议包只是参考实现。实现可以完全不采用任何 DSH Standard 协议，自主实现自己的协商与选择逻辑。
- **鼓励 agent 自我进化实现**。规范不定义"未来生态必须长什么样"；实现者可以在元协议之上自由探索新的协议、协商模型与运行形态。
- **鼓励激进的 Agent 架构探索**。无界面设施、常驻 Agent、远程 Runtime、事件驱动系统，乃至今天尚不存在的 Agent 架构，都可以在同一元协议之上出现；当新的形态出现时，以新协议与 Profile 替代旧协议即可，无需推翻标准自身。
- 希望获得"传统 Host + Plugin + Manifest"开发体验的项目，可以遵循对应 Profile（见 dsh-ecosystem-spec）；不采用这些概念的实现不受任何限制。

## 从这里开始

- 阅读[架构](docs/architecture.zh.md)，了解元协议、独立协议与产品实现的边界。
- 各组件的拟议设计集中在[设计提案索引](docs/proposals/README.zh.md)。
- `@dsh-std/connection` 的设计提案见 [Endpoint Connection](docs/proposals/endpoint-connection.zh.md)。
- 通过[包索引](packages/README.zh.md)选择所需的最小协议包。
- 产品集成应位于 [`@dsh-std/adapter-dsh`](packages/adapter-dsh/README.zh.md) 之类的适配器中，不进入可移植的标准包。

## 状态

现有代码与提案均处于早期草案阶段。提案中的目标边界可能领先于当前 TypeScript 原型；实现迁移完成前不应把现有导出视为稳定 API。

每个包在自身的 `CHANGELOG.md` 中记录协议、类型、校验器与适配行为的变化。修改某个包的公开 contract 时，必须同时更新该包的 changelog；发布产物也包含这份记录。

## 开发

需要 Node.js `^22.19 || >=24` 与 pnpm。

```sh
pnpm install
pnpm check
```

## 许可证

[MIT](LICENSE)
