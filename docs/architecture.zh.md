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
- `agent` 定义活动 Agent 的控制与配置；
- `session` 定义持久 Session 的目录、历史和事件 vocabulary；
- `workspace` 定义 Workspace 注册记录与 Session 归属；
- `content` 定义跨协议共享的内容引用与传输；
- `command` 定义命令目录与执行语义；
- `tool` 定义工具发现和披露；
- `model` 定义模型提供方目录；
- `presentation` 定义一次交互中可以请求的表现操作。

各领域协议分别声明版本和语义。Connection 承载领域协议的交互，但不解释领域数据。

协议包可以包含类型、schema、codec、协商算法、状态机和一致性测试。提案标明其中哪些内容具有规范性。

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

产品选择需要实现的协议，并将协议操作绑定到运行时能力。文件系统、网络、凭据、进程、界面和 policy 属于产品实现。

## 声明与协商

协商包含三个不同事实：

1. evaluator **理解**某份协议，因此能校验和协商它；
2. participant **支持**某份协议，因此当前存在符合该声明的实现；
3. 一组 participant 对该协议形成了 **agreement**。

Evaluator knowledge、participant support 和 agreement 是分别声明和计算的状态。权限由相应协议或产品 policy 判定。

Core 只调度协议 definition。具体协议决定自己需要几方参与、是否允许多个实现、如何选择版本、是否产生 binding，以及发生变化时如何重新协商。

## Connection

Connection 是使用 core 元协议的一份独立协议。它定义 endpoint identity、offer、plan、binding、调用生命周期、attachment 传输和连接状态。

Wire profile 定义 encoding、framing、认证绑定、流控和关闭过程。Carrier profile 定义 Connection 对底层通道的要求。

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

Manifest 声明 component 和 facet。Facet 被激活后产生 activation instance；该 instance 可以在协商范围内发布 participant declaration。

Facet 的 `activation` 是开放的版本化对象。Activation definition 规定其参数，activation driver 执行生命周期操作。Composition 根据可用 definition、driver 和协议要求选择 facet。

## 包边界

- [`@dsh-std/core`](../packages/core/README.zh.md) 定义可拔插协议的声明与协商元协议；
- [`command`](../packages/command/README.zh.md)、[`model`](../packages/model/README.zh.md)、[`tool`](../packages/tool/README.zh.md)、[`session`](../packages/session/README.zh.md) 和 [`presentation`](../packages/presentation/README.zh.md) 分别定义领域协议；
- [`@dsh-std/connection`](../packages/connection/README.zh.md) 定义 endpoint 连接协议及其参考实现部件；
- [`@dsh-std/adapter-dsh`](../packages/adapter-dsh/README.zh.md) 将标准协议映射到 DeepSeek Harness。

标准包之间只建立提案中明确说明的依赖。新增领域协议不要求修改 core，也不要求已有实现采用它。

## 兼容性与演进

每份协议独立携带 `apiVersion`。Core 只识别协议身份并把协商交给相应 definition；版本兼容关系由协议自身规定。

不兼容的领域语义使用新的协议版本。迁移期间，一个实现可以同时声明多个版本。是否允许同一连接或同一进程同时协商多个版本，也由相应协议定义。

实现应提供机器可读的协商报告，使启动器、CI、市场和诊断界面能够区分未知协议、版本不兼容、可选项缺失和协议专属错误。
