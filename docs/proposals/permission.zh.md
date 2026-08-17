# `@dsh-std/permission` 设计提案

- 文档类型：设计提案
- 状态：探索性草案
- 日期：2026-08-16

## Summary

`@dsh-std/permission` 定义 facet 如何静态请求权限、产品 policy 如何产生 grant，以及 SDK 与 adapter 如何在运行时执行和撤销 grant。

Permission 与 core 协议协商相互独立。协商证明参与者在协议层能够共同工作；permission 决定某个 facet activation instance 是否可以在特定范围执行某项受保护操作。

## Motivation

协议 support、Host API 存在和用户授权是三个不同事实。如果仅凭插件声明或 capability negotiation 暴露完整 context，插件可以使用未展示给用户的文件、网络、session 或 UI 能力。

需要一个共同模型支持：

- 安装前列出权限请求和理由；
- profile、管理员与用户 policy 共同决策；
- SDK 只提供已授予的接口；
- grant 可以限定 resource、session、workspace 或连接；
- 停用、断开或用户撤销后立即失效；
- 审计记录能关联到 component、facet、activation instance 和实际操作。

## Guide-level explanation

Facet 在 manifest 中声明自己的 permission requests。每项 request 引用一个版本化 permission kind，并携带该 kind 定义的 scope。

Composition 把 request、运行环境支持情况和 policy 交给 permission evaluator。Evaluator 产生 allow、deny 或需要交互确认的 decision。

Lifecycle 激活 facet 时，只向 activation context 注入由 grant 覆盖的 scoped API。实现代码不能通过字符串查询未授予的 Host service。

Grant 在 activation instance 停止、scope 关闭、连接断开或 policy 撤销时失效。

## Reference-level explanation

### Permission definition

具体权限由领域包定义。例如 fs、net、session、storage、events 和 presentation 分别拥有自己的 action 与 scope schema。

```ts
interface PermissionReference extends ApiReference {
  readonly action: string
  readonly scope?: unknown
}
```

Permission 包定义请求、决策和 grant 外壳，不集中维护所有 action 字符串。领域 definition 负责校验 scope、判断包含关系，并生成适合展示的摘要。

### Static request

Manifest request 至少包含 permission reference、是否为必需项和用户可读理由。理由用于安装界面，不参与授权逻辑。

静态请求是所属 facet 可能使用的上限。运行时 API 不能签发超出该 facet manifest 请求的 grant。动态缩小 scope 可以无需修改 manifest；扩大 scope 需要新的声明和 policy 决策。

### Decision inputs

Permission evaluator 的输入包括：

- component manifest 与发行物 provenance；
- composition plan 中选择的 facet 与 activation instance；
- 产品支持的 permission definitions；
- profile、管理员和用户 policy；
- 本次 activation、connection 或 invocation 的资源范围；
- 已有 grant 和撤销状态。

插件自身提供的默认值只能缩小请求，不能覆盖产品 policy。

### Grant

Grant 是由授权方签发的运行时对象，至少记录：

- grant id；
- activation instance principal；
- permission apiVersion、kind 与 action；
- 规范化 scope；
- 签发者与 policy revision；
- 生效、到期和撤销状态；
- 父 scope，例如 activation、connection 或 invocation。

序列化的 grant record 用于诊断，不是可重放的 bearer token。插件取得的是由 SDK 封装的 scoped API 或不可伪造 handle，不能用 grant id 构造权限。

### Enforcement

每项受保护操作在产生副作用的位置检查 grant。Manifest validator、composition report 或 UI 中显示“已允许”都不能替代运行时检查。

Adapter 负责把标准 permission 映射到产品已有的 sandbox、approval、guard 和 policy。若产品无法执行某项 scope，它必须拒绝该 grant，不能以支持标准为由降级成更宽权限。

### Revocation

Grant 撤销后：

- 不接纳新的操作；
- 仍在执行的操作按 permission definition 的 revocation policy 取消、完成或进入隔离收尾；
- 由该 grant 创建的订阅、连接或临时资源通过 lifecycle scope 清理；
- SDK handle 后续调用返回稳定的 revoked error。

Activation instance 停止会撤销其全部 grant。Invocation-scoped grant 在 invocation 结束时撤销，不进入 session 持久记录。

### Approval interaction

需要用户决定时，evaluator 产生结构化 pending decision。Presentation 实现可以把它显示为 TUI、Web、GUI 或非交互 CLI 提示。

Permission 协议定义决策内容和确认结果，不规定具体 UI。敏感一次性值只存在于 invocation-scoped presentation channel，不写入普通 session event 或持久日志。

### Audit

审计记录关联 request、decision、grant、component、facet、activation instance、目标 scope 和最终操作结果。拒绝、撤销、超范围尝试和 adapter 无法执行 scope 都有稳定 code。

领域 adapter 在记录前移除凭据、文件内容、工具输入和其他不属于 permission 诊断的数据。

## Security considerations

协议 support、connection binding、component identity 和 permission grant 分别解决不同问题，不能互相替代。

远端传来的 component id 不是本地 principal。Connection acceptor 先建立经过认证的 peer identity，本地 permission authority 再决定是否为该连接内的 participant 签发 scope。

Grant 的包含关系由 permission definition 校验。实现不能使用字符串前缀等未经协议规定的方法判断路径、域名或 resource scope。

## Drawbacks

细粒度 scope 增加 manifest 与授权界面的复杂度，也要求 adapter 在每个副作用入口执行检查。

产品原有 API 若只提供全局权限，可能无法忠实实现标准 scope。这类产品需要拒绝细粒度 grant 或先增加隔离能力。

## Rationale and alternatives

### 把 core agreement 当作 grant

Agreement 只表示协议兼容，不含用户 policy、principal 或资源范围。Permission 使用独立 decision 与可撤销 grant。

### 注入完整 Host context，由插件自行判断

自律检查不能限制恶意或有缺陷的插件。SDK 只暴露 grant 覆盖的 API，adapter 在实际副作用位置再次执行。

### 在 permission 包中固定所有能力名称

文件、网络、session、event interception 和未来协议的 scope 语义不同。Permission 包提供共同 envelope，领域包独立版本化自己的 permission definitions。

## Unresolved questions

### Policy interchange

第一版是否标准化 policy 文件，还是只标准化 request、decision 与 grant，让各产品保留自己的 policy language，尚未决定。

### Delegation

一个已授权 activation instance 是否可以把更小 scope 委托给 worker 或远端 participant，需要定义明确 delegation chain，第一版可先禁止隐式转授。

### Prompt deduplication

相同 request 在版本升级、scope 变化或 provenance 变化后何时需要重新确认，需要与安装器和市场信任模型共同确定。
