# `@dsh-std/storage` 协议提案

- 文档类型：协议提案
- 状态：草案
- 日期：2026-08-20

## 摘要

`@dsh-std/storage` 定义 `storage.dsh/v1alpha1` `LocalStorage`。该协议为 Component 提供由宿主管理的私有 JSON 键值存储，并规定命名空间隔离、授权、并发与保留语义。

本文中的“必须”“禁止”“应”“不应”和“可以”分别对应 MUST、MUST NOT、SHOULD、SHOULD NOT 和 MAY。

## 协议坐标

```text
apiVersion: storage.dsh/v1alpha1
kind: LocalStorage
```

Consumer 通过 protocol requirement 声明需要 `LocalStorage`。Provider 通过 protocol support 声明可以为 Consumer 提供该能力。省略 `spec` 表示只要求基础 get/set/delete profile，并与 `0.1.0-rc1` 的声明完全等价。

`v1alpha1` 还定义两个显式协商的可选 feature：

- `presence`：提供 `has`，用于区分不存在的 key 与显式存储的 JSON `null`；
- `list`：提供有界 cursor 分页的 key 枚举。

Consumer 可以在 requirement `spec.features` 中列出所需 feature。Provider 只有在 support `spec.features` 中列出相同 feature 时才是该 requirement 的候选。Provider 声明 `list` 时必须同时声明正整数 `maxListPageSize`。未知 feature 必须拒绝，不能静默忽略。没有 `spec` 的旧 Provider 仍是基础 profile 的有效候选，但不能满足任何可选 feature。

每个 Consumer 必须绑定到唯一 Provider。存在多个候选 Provider 且组合层没有作出确定选择时，协商必须失败，不能以注册或加载顺序选择 Provider。

## 命名空间

Provider 必须为每个 Component 分配互相隔离的命名空间。调用方不得在请求中指定其他 Component 的标识或命名空间。

Provider 必须从经过验证的调用身份确定命名空间。对其他 Component 命名空间的读写必须被拒绝。Activation instance 可以共享所属 Component 的存储，但不能因此获得其他 Component 的访问权。

Key 是非空字符串。Key 没有文件路径语义；Provider 禁止把 `.`、`..`、路径分隔符或 Unicode 规范化解释成跨命名空间访问。Provider 可以规定 key 长度、总容量和单值大小限制，但必须在写入前稳定地拒绝超限操作。

## 数据模型

Value 必须是 JSON value：`null`、boolean、有限 number、string、JSON value array，或以 string 为键、JSON value 为值的 object。`undefined`、`bigint`、非有限 number、函数、symbol、循环引用和带运行时原型语义的对象不是有效 value。

Provider 返回的 value 必须与已提交 value 在 JSON 数据模型下等价。调用方不得依赖对象 identity、prototype、属性描述符或 key 排列顺序。

## 操作

### `get`

```text
input:  { key: string }
output: { value: JsonValue | null }
```

`get` 返回当前命名空间中 key 对应的 value。Key 不存在时返回 `null`。基础 profile 不区分“未存储”和“显式存储 null”；未协商 `presence` 而又需要区分时，调用方必须在自身 value 中使用其他编码。

协商了 `presence` 的 Consumer 可以改用 `has` 区分这两种状态；这不改变 `get` 的既有返回形状与含义。

### `set`

```text
input:  { key: string, value: JsonValue }
output: { stored: true }
```

`set` 原子替换指定 key 的 value。成功返回前，后续同一 key 操作必须能够观察到新值。失败不得留下部分 value。

### `delete`

```text
input:  { key: string }
output: { deleted: boolean }
```

`delete` 移除指定 key。`deleted` 表示本次操作是否移除了已有值。删除不存在的 key 必须成功并返回 `false`。

### `has`（`presence` feature）

```text
input:  { key: string }
output: { exists: boolean }
```

只有 agreement 为该 Consumer 授予 `presence` 时才可调用。`exists` 只表示 key 是否存在，不读取或返回 value；显式存储 JSON `null` 的 key 必须返回 `true`。

### `list`（`list` feature）

```text
input:  { limit: positive integer, prefix?: string, cursor?: string }
output: { keys: string[], nextCursor?: string }
```

只有 agreement 为该 Consumer 授予 `list` 时才可调用。`limit` 不得超过 agreement 中该 Provider 的 `maxListPageSize`。`prefix` 缺省时匹配当前命名空间内所有 key；空字符串与缺省等价。`cursor` 是 Provider 产生的不透明 continuation token，Consumer 禁止解析、拼接或跨 Component 使用。

每页 `keys` 不得重复，并且必须全部匹配 `prefix`。存在后续页时 Provider 必须返回非空 `nextCursor`；遍历结束时必须省略它。协议不保证跨页 snapshot isolation：遍历期间的并发 set/delete 可以影响后续页，但 Provider 不得因此越过 Component 命名空间边界。

## 并发

Provider 必须串行化同一 Component 命名空间内、同一 key 上的操作。操作顺序以 Provider 接纳调用的顺序为准。不同 key 的操作可以并发。

基础 profile 不提供多 key transaction、compare-and-swap、enumeration 或 watch。实现不得把可选 feature 或其他非标准行为作为基础 `LocalStorage` 兼容性的前提。`list` 只提供协商后的有界枚举，不提供 transaction、稳定 snapshot 或 watch。

## 权限

读取需要 `storage.local.read`，写入和删除需要 `storage.local.write`。权限作用域必须绑定 Component 的存储命名空间，默认拒绝，并且可以撤销。

Provider 必须在每次操作时检查当前 grant。撤销 grant 后开始的新操作必须失败；已经开始的操作是否完成由宿主的取消边界决定，但不能借此建立新的未授权调用。

## 生命周期与保留

Facet deactivate 不删除 Component 数据。Provider 必须声明 uninstall 后的数据保留规则。显式 purge 必须删除整个 Component 命名空间，并且应要求产品层确认。

Cleanup 和 purge 必须可重复执行。失败的 cleanup 不得被报告为已完成。

## 错误

实现必须能够稳定区分下列错误：

- `PERMISSION_NOT_GRANTED`：当前操作缺少 grant；
- `INVALID_KEY`：key 不符合 Provider 声明的边界；
- `INVALID_CURSOR`：`list` cursor 无效、过期或不属于当前 Component/prefix；
- `INVALID_VALUE`：value 不是 JSON value；
- `FEATURE_NOT_NEGOTIATED`：调用方试图使用 agreement 未授予的可选 feature；
- `QUOTA_EXCEEDED`：操作超过已声明配额；
- `STORAGE_UNAVAILABLE`：Provider 无法完成存储操作。

错误可以携带不敏感的诊断信息，但不能暴露其他 Component 的 key、value、路径或配额使用明细。

## 安全考虑

`LocalStorage` 是访问与互操作协议，不自动构成进程隔离。Trusted in-process 插件可能绕过 Provider 直接使用宿主进程权限；产品不得把协议声明描述成沙箱保证。

Value 可能包含敏感信息。Provider 禁止把 value、凭据或 secret 写入普通日志。备份、同步和诊断导出必须遵守与原命名空间相同的访问边界。

## 兼容性

改变命名空间归属、JSON value 模型、操作原子性、权限动作或错误含义属于协议兼容性变更，必须使用新的 `apiVersion`。

在 `0.1.0-rcN` 发布线内，新增能力必须保持基础 get/set/delete 声明、操作形状和含义不变。`presence` 与 `list` 只能通过 `spec.features` 显式协商；省略 `spec` 的 rc1 Consumer 和 Provider 必须继续得到原有 binding 形状，不能被自动授予新操作。

`0.1.1-rcN` 发布线可以开始新的包级开发 API 兼容周期，但改变命名空间归属、JSON value 模型、既有操作原子性、权限动作或错误含义仍必须使用新的协议 `apiVersion`。
