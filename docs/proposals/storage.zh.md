# `@dsh-std/storage` 协议提案

- 文档类型：协议提案
- 状态：草案
- 日期：2026-08-17

## 摘要

`@dsh-std/storage` 定义 `storage.dsh/v1alpha1` `LocalStorage`。该协议为 Component 提供由宿主管理的私有 JSON 键值存储，并规定命名空间隔离、授权、并发与保留语义。

本文中的“必须”“禁止”“应”“不应”和“可以”分别对应 MUST、MUST NOT、SHOULD、SHOULD NOT 和 MAY。

## 协议坐标

```text
apiVersion: storage.dsh/v1alpha1
kind: LocalStorage
```

Consumer 通过 protocol requirement 声明需要 `LocalStorage`。Provider 通过 protocol support 声明可以为 Consumer 提供该能力。Requirement 与 support 在 `v1alpha1` 中不携带 `spec`。

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

`get` 返回当前命名空间中 key 对应的 value。Key 不存在时返回 `null`。协议不区分“未存储”和“显式存储 null”；需要区分时，调用方必须在自身 value 中使用其他编码。

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

## 并发

Provider 必须串行化同一 Component 命名空间内、同一 key 上的操作。操作顺序以 Provider 接纳调用的顺序为准。不同 key 的操作可以并发。

本协议不提供多 key transaction、compare-and-swap、enumeration 或 watch。实现不得把这些非标准行为作为 `LocalStorage` 兼容性的前提。

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
- `INVALID_VALUE`：value 不是 JSON value；
- `QUOTA_EXCEEDED`：操作超过已声明配额；
- `STORAGE_UNAVAILABLE`：Provider 无法完成存储操作。

错误可以携带不敏感的诊断信息，但不能暴露其他 Component 的 key、value、路径或配额使用明细。

## 安全考虑

`LocalStorage` 是访问与互操作协议，不自动构成进程隔离。Trusted in-process 插件可能绕过 Provider 直接使用宿主进程权限；产品不得把协议声明描述成沙箱保证。

Value 可能包含敏感信息。Provider 禁止把 value、凭据或 secret 写入普通日志。备份、同步和诊断导出必须遵守与原命名空间相同的访问边界。

## 兼容性

改变命名空间归属、JSON value 模型、操作原子性、权限动作或错误含义属于协议兼容性变更，必须使用新的 `apiVersion`。

增加不影响既有操作的可选 Provider 限制描述，可以通过 namespaced extension 表达；Consumer 不得要求未知 extension 才能使用 `v1alpha1` 基本操作。
