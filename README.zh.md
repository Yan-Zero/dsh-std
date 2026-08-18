# DSH Standard

[English](README.md) | 中文

DSH Standard 是一组可以按需实现、彼此独立版本化的协议，用于让 DSH 插件、运行时和用户界面互操作。

`@dsh-std/core` 是声明和协商其他协议的元协议。Connection、command、tool、presentation 等协议通过 core 被发现，但分别定义自己的语义；Host、TUI、Web、GUI 和其他程序可以只实现需要的部分。

协议包可以提供类型、校验器、协商算法、状态机或一致性测试作为参考实现。符合规范的实现不要求使用这些 TypeScript 包，也不要求依赖 DeepSeek Harness。

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
