# Provenance 与影响记录设计提案

- 文档类型：设计提案
- 状态：探索性草案
- 日期：2026-08-16

## Summary

本提案定义安装前影响报告和运行时 ownership/provenance 记录的共同结构，使用户能够知道一个 component 将修改什么、实际注册了什么，以及失败或残留由谁产生。

Provenance 是可观察性与归责数据，不负责激活、授权或回滚本身。

## Motivation

插件系统只记录“已安装”不足以诊断以下问题：

- 哪个 component 注册了某项 protocol support、command、tool 或 UI；
- 哪个 adapter 包装了产品方法，是否能恢复；
- 哪项 permission request 在安装时获批，运行时使用了哪个 grant；
- 激活失败后留下了哪些 registration；
- 当前行为来自原始包、配置覆盖还是连接远端。

安装影响分析与运行归属需要一份可机器读取、能关联 manifest、composition、lifecycle 和 permission 的记录模型。

## Guide-level explanation

安装器从 manifest、composition rules 和 permission requests 生成静态 `ImpactReport`。它列出计划安装的依赖、facets、activations、extensions、permissions，以及 adapter 能够预先识别的非标准影响。

运行时为实际 registration 生成 `OwnershipRecord`。每条记录关联 component、facet、activation instance、protocol、adapter、lifecycle scope 和创建它的 plan revision。

诊断工具比较 plan 与实际记录，可以发现未发布的 support、未清理的 handler 或超出静态声明的影响。

## Reference-level explanation

### Impact report

ImpactReport 至少包含：

- component manifest identity、source 与 digest；
- 将添加、更新或移除的 packages/components；
- protocol requirements 与潜在 supports；
- facets、activations 和 static extensions；
- permission requests；
- adapter 声明的非标准影响；
- composition conflicts、warnings 与 policy decisions；
- validator/evaluator identity 和输入 digest。

Impact report 在执行安装或 activation 之前生成。动态代码仍可能尝试未声明行为，因此报告不是 sandbox 保证。

### Ownership record

OwnershipRecord 至少包含：

- record id 和 kind；
- component、facet 与 activation instance identity；
- adapter/implementation identity；
- protocol reference；
- product-local target 的稳定、已脱敏标识；
- lifecycle scope 与 plan revision；
- created/removed time；
- 当前状态和最后诊断。

Record kind 由领域协议扩展，例如 service、event-subscription、interceptor、command、tool、UI contribution、connection attachment 或 mutation。

### Correlation

Manifest item、composition decision、permission grant、lifecycle transition 和 ownership record 使用显式 id 关联。日志文本或对象内存地址不能作为唯一关联键。

远端 participant 的 provenance 与本地 component provenance 分开保存。Connection 可以记录经过认证的 peer 与 agreement，但不能把对端自报 plugin id 变成本地 package owner。

### Cleanup verification

Lifecycle scope 关闭后，provenance collector 检查仍处于 active 的 owner records。能自动撤销的 registration 继续清理；无法确认清理的目标标记为 leaked 或 unknown，并附带 adapter 诊断。

Provenance 不自行调用任意补偿逻辑。回滚动作由 lifecycle、installer 或具体 adapter 实现，并产生新的 record。

### Storage and privacy

Record 使用数据最小化原则。默认不保存：

- permission bearer handle 或凭据；
- tool/command 的完整输入输出；
- session 消息正文；
- device code、secret input 或 approval token；
- 原始异常 stack 与本地绝对路径。

实现定义 retention 与访问 policy，并在导出报告时再次脱敏。

## Security considerations

Component 不能写入或修改自己的权威 ownership record。Record 由 adapter、lifecycle coordinator、permission authority 和 connection implementation 在实际操作点产生。

Provenance store 包含安装结构和行为元数据，可能帮助攻击者了解系统；读取和导出需要独立 permission。

## Drawbacks

细粒度 ownership 需要所有 adapter 在注册与清理路径打点。未改造的 legacy API 只能提供部分记录。

保留足够诊断信息与避免泄露用户数据之间存在张力，各领域协议需要定义安全摘要。

## Rationale and alternatives

### 只记录日志

日志难以稳定关联 plan、owner 与 cleanup，也不适合作为市场或 UI 的结构化输入。Provenance record 可以附带日志引用，但拥有独立 schema。

### 由插件自己报告影响

Manifest 是声明来源，但运行时事实必须在实际 registration 与副作用入口由宿主记录，否则无法发现越界或残留。

## Unresolved questions

### Record transport

远端诊断是否通过独立 provenance query protocol 暴露，以及哪些字段可跨信任域传输，需要与 connection/permission 共同设计。

### Stable target identifiers

Cordis service、method wrapper、filesystem path 和 UI placement 的 target id 需要由各 adapter 定义，通用 envelope 只规定归属字段。
