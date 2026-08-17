# DSH Standard 架构

[English](architecture.md) | 中文

本文说明 DSH Standard 的规范如何分层，以及规范与产品实现之间的边界。

## DSH Standard 是什么

DSH Standard 是一组可以分别实现的协议。它不提供一个必须完整采用的框架，也不要求所有实现运行在 DeepSeek Harness 中。

Host、TUI、Web、GUI、插件、远端代理或其他程序可以只实现自己需要的协议。两个组件能否协作，由它们声明的协议及协商结果决定，而不是由产品名称或是否安装同一个 npm 包决定。

## Core 元协议

`@dsh-std/core` 定义协议身份、参与者声明和协商外壳。参与者可以声明：

- 它需要哪些协议，其中哪些是可选的；
- 它在当前范围内实际支持哪些协议；
- 对应协议定义的专属协商参数。

Core 根据 `apiVersion` 与 `kind` 找到协议 definition，再由该 definition 校验参数并计算协议结果。Core 汇总这些结果，但不解释其中的业务内容。

Core 不预设 resource、capability、provider、execution plane、endpoint 或 UI。某份协议需要这些概念时，由该协议定义。

## 独立协议

Core 之上是彼此独立的协议。例如：

- `connection` 定义 endpoint 如何提交 offer、形成 agreement，并在连接中保持双方一致；
- `command` 定义命令目录与执行语义；
- `tool` 定义工具发现和披露；
- `model` 定义模型提供方目录；
- `presentation` 定义一次交互中可以请求的表现操作。

实现 connection 不会自动获得 command 或 tool。Connection 可以承载其他协议的数据和调用，但不解释这些业务。

协议包可以包含参考代码。代码的范围取决于协议本身：简单协议可能只有类型与 schema；connection 可以包含协商器、codec、状态机和一致性检查。参考代码不替产品完成网络监听、进程管理、界面渲染或业务 handler。

## 产品实现

产品负责把协议落实到实际环境：

```text
                        @dsh-std/core
                       协议声明与协商
                              |
           +------------------+------------------+
           |                  |                  |
      connection          command/tool      presentation
      独立协议规范          独立协议规范        独立协议规范
           |                  |                  |
           +------------------+------------------+
                              |
                 host / tui / web / gui / plugin
                         按需实现协议
```

例如：

- Host 可以实现 connection 的 acceptor，并实现 agent-control；
- Remote SSH 可以实现 connection 的一种 carrier；
- TUI 和 Web 可以实现 connection 的 connector，也可以实现 presentation；
- DSH adapter 可以把 command 或 tool 协议映射到 Harness 已有服务；
- 另一个产品可以从头实现相同协议，不依赖 DSH adapter。

规范中随附的 helper 只负责规范已经定义的确定性行为。文件系统、端口、认证凭据、进程、UI widget、Cordis service 和产品 policy 均由实现拥有。

## 声明与协商

协商包含三个不同事实：

1. evaluator **理解**某份协议，因此能校验和协商它；
2. participant **支持**某份协议，因此当前存在符合该声明的实现；
3. 一组 participant 对该协议形成了 **agreement**。

三者不能相互推断。安装协议定义不表示运行时已经实现它；静态包清单中的潜在支持也不表示当前可用；agreement 也不自动授予越过产品权限边界的调用权。

Core 只调度协议 definition。具体协议决定自己需要几方参与、是否允许多个实现、如何选择版本、是否产生 binding，以及发生变化时如何重新协商。

## Connection

Connection 是使用 core 元协议的一份独立协议，而不是 core 的固定传输层。

Connection 定义 endpoint offer、双方接受的 plan、调用生命周期和连接状态。它可以提供足够具体的参考算法与状态机，使不同实现得到相同结果。它仍不处理 command、tool、session 或 agent 等业务。

Host、TUI、Web 和 GUI 可以分别实现 connection。实际 carrier 可以是进程内调用、IPC、stdio、HTTP、WebSocket、SSH 转发、QUIC 或其他方式。协议是否统一 wire framing、认证、重连和流控，由 connection 及其配套 wire proposal 决定。

## 插件与组合

插件安装包、入口文件、插件间依赖、生命周期、权限和 contribution 不属于 core 元协议。这些内容分别由 [`@dsh-std/manifest`](proposals/manifest.zh.md)、[`@dsh-std/composition`](proposals/composition.zh.md)、[`@dsh-std/lifecycle`](proposals/lifecycle.zh.md)、[`@dsh-std/events`](proposals/events.zh.md) 和 [`@dsh-std/permission`](proposals/permission.zh.md) 提案定义。

这些提案可以引用 core 的协议声明，使插件表达“需要 connection v1”或“支持 presentation v1”。不采用 DSH 插件模型的程序仍然可以直接提交同样的协议声明。

组件系统区分三个层次：

```text
Component                    安装、版本和来源单位
└── Facet                    静态选择与激活单位
    └── Activation instance  生命周期、权限和本地归属单位
        └── Participant      某次 core 协商中的运行实体
```

第一版组件模型中，一个 activation instance 对应一个本地 participant；只提供 extension handler 时不必把空 declaration 交给 core。Manifest 记录到 facet 为止，不预先制造 live participant，也不把静态 supports 当作 live facts。

Facet 的 `activation` 是开放的版本化对象。产品 adapter 可以定义 Cordis、浏览器或其他 activation kind，并向 loader 注册相应 driver；core 不维护 `client/server`、`local/remote` 或 profile 枚举。Composition 只选择当前 loader 有明确 driver 且静态要求可以满足的 facets。

## 包边界

- [`@dsh-std/core`](../packages/core/README.zh.md) 定义可拔插协议的声明与协商元协议；
- [`command`](../packages/command/README.zh.md)、[`model`](../packages/model/README.zh.md)、[`tool`](../packages/tool/README.zh.md)、[`session`](../packages/session/README.zh.md) 和 [`presentation`](../packages/presentation/README.zh.md) 分别定义领域协议；
- [`@dsh-std/connection`](../packages/connection/README.zh.md) 定义 endpoint 连接协议及其参考实现部件；
- [`@dsh-std/adapter-dsh`](../packages/adapter-dsh/README.zh.md) 是 DeepSeek Harness 的产品实现与映射层。

标准包之间只建立提案中明确说明的依赖。新增领域协议不要求修改 core，也不要求已有实现采用它。

## 兼容性与演进

每份协议独立携带 `apiVersion`。Core 只识别协议身份并把协商交给相应 definition；版本兼容关系由协议自身规定。

不兼容的领域语义使用新的协议版本。迁移期间，一个实现可以同时声明多个版本。是否允许同一连接或同一进程同时协商多个版本，也由相应协议定义。

实现应提供机器可读的协商报告，使启动器、CI、市场和诊断界面能够区分未知协议、版本不兼容、可选项缺失和协议专属错误。
