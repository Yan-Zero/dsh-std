# `@dsh-std/presentation` 设计提案

- 文档类型：设计提案
- 状态：草案
- 日期：2026-08-16

## Summary

`@dsh-std/presentation` 定义 runtime 可以请求 presentation endpoint 执行的三项最小操作：打开网页、复制文本和显示通知。

协议包只定义 contract identity、operation 数据和校验函数。终端、浏览器、编辑器和自动化客户端分别决定自己实现哪些 contract。

## Motivation

Runtime 插件有时需要完成少量用户侧操作，例如打开认证页面或显示提示。直接调用浏览器、剪贴板或某个 UI 框架，会把插件绑定到运行位置和产品实现。

Presentation contract 让插件声明自己需要的用户侧操作。连接或调用适配器确认客户端支持后，再把结构化 operation 交给客户端执行。

该协议有意保持窄小，不把完整 UI framework、任意对话框或全局事件总线纳入标准。

## Guide-level explanation

需要打开认证页面的插件声明 `OpenExternal` requirement，并产生 operation：

```ts
{
  apiVersion: 'presentation.dsh/v1alpha1',
  kind: 'OpenExternal',
  uri: 'https://example.test/login',
}
```

客户端只有在当前调用中声明并实现 `OpenExternal` 时才接收该 operation。没有该 capability 时，runtime 可以拒绝需要它的操作，或者由插件为 optional requirement 提供降级结果。

## Reference-level explanation

### Contracts

`v1alpha1` 定义三项可以独立声明 support 的 presentation protocol：

| Kind | Operation |
| --- | --- |
| `OpenExternal` | 打开一个 HTTP 或 HTTPS URI |
| `CopyText` | 将非空文本写入剪贴板 |
| `Notification` | 显示 info、warning 或 error 通知 |

三个 kind 独立声明和协商。实现其中一个不表示实现另外两个，也不要求 core 认识 presentation 的具体操作。

### Operation

```ts
type Operation =
  | { apiVersion: 'presentation.dsh/v1alpha1'; kind: 'OpenExternal'; uri: string }
  | { apiVersion: 'presentation.dsh/v1alpha1'; kind: 'CopyText'; text: string }
  | {
      apiVersion: 'presentation.dsh/v1alpha1'
      kind: 'Notification'
      text: string
      level?: 'info' | 'warning' | 'error'
    }
```

`validateOperation()` 在 operation 交给 transport 或客户端前校验数据：

- API version 必须受支持；
- `OpenExternal.uri` 必须解析为 HTTP(S) URL；
- `CopyText.text` 和 `Notification.text` 不能为空；
- Notification level 只能取已声明值。

### Invocation scope

Operation 属于产生它的调用。它不表示客户端建立了永久订阅，也不进入全局广播队列。

当前 command adapter 把 operation 收集到 `CommandExecution.operations` 中。Connection 的反向 capability 调用稳定后，可以由 presentation implementation 直接处理；两种传递方式不得改变 operation 字段含义。

### Capability declaration

使用 presentation 的 facet 在自身 `protocols.requires` 中声明相应 kind。Presentation endpoint 在连接 offer 中只报告当前实现的 kind。适配器在转发 operation 前检查调用方 activation instance 所属 facet 已声明 requirement。

## Drawbacks

三个操作不足以覆盖文件选择、秘密输入、确认框、富通知和编辑器导航。保持较小集合可以减少权限面，但插件仍可能需要产品专用交互。

当前 operation 没有确认结果。Runtime 只能知道请求已被接受或调用失败，不能得知用户是否真正查看页面、剪贴板是否随后被覆盖等外部状态。

`CopyText` 涉及用户数据泄露风险，但 `v1alpha1` 没有标准化 approval UI；实现仍需应用自身 policy。

## Rationale and alternatives

### 一个通用 `UiOperation`

通用 union 会使客户端难以声明最小权限，也会让不相关操作共享版本。独立 contract kind 允许客户端逐项实现和授权。

### 直接执行平台 API

远端或无界面 runtime 不一定有浏览器和剪贴板。把执行放在 presentation endpoint 可以保留正确的用户环境。

### 使用 URI scheme 表示所有操作

自定义 URI 难以表达通知等级和文本数据，也容易绕过 scheme-specific 安全检查。Operation 使用明确字段。

## Unresolved questions

### Delivery result

后续版本是否为每项 operation 定义 acknowledgment 或结果，尚未确定。

### User interaction

需要返回用户输入的 question、approval 和 file picker 是否属于 presentation 包，还是独立的交互协议，需要分别设计其取消、超时和隐私语义。

### Direct invocation

Presentation 包目前没有像 command/model 那样导出类型化 connection client 与 implementation wrapper。该 API 应与 connection 提案的双向调用模型一起确定。
