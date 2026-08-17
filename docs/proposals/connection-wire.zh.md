# `@dsh-std/connection/wire` 设计提案

- 文档类型：设计提案
- 状态：草案
- 日期：2026-08-17

## Summary

`@dsh-std/connection/wire` 定义 `connection.cbor.dsh/v1alpha1` wire profile。它在经过认证、可靠且有序的 carrier channel 上承载 endpoint hello、offer、plan acceptance、protocol attachment、flow control 和关闭。

Wire profile 是 `@dsh-std/connection` 的 subpath 和互操作格式，不是独立 npm 包。应用、TUI 和领域插件不解析该 wire；Connection Host 和 wire adapter 实现它。

Profile 使用 [RFC 8949](https://www.rfc-editor.org/rfc/rfc8949.html) CBOR，并限制为确定性、可有界解码的子集。Carrier 可以是 IPC、stdio、OpenSSH channel、QUIC stream、WebSocket 或其他满足前置条件的实现。

本 profile 不定义 target discovery、SSH、TLS、端口转发、用户认证流程或领域业务消息。

## Carrier requirements

Wire 只运行在满足以下条件的 channel 上：

- 字节可靠、有序且不重复；
- 双方能够检测 channel 关闭；
- Connection Host 在处理 offer 前取得经过 carrier 认证的 peer identity；
- 认证结果和 channel 实例不可被其他未认证连接复用；
- carrier 对单连接并发、缓冲和 lifetime 有界。

Raw、未认证 TCP 不是本 profile 的合规 carrier。TLS、SSH、QUIC 或本地 IPC 的具体认证方式由 carrier profile 定义；Connection Wire 接收认证结果作为 policy input，不重新传输 credential。

消息型 carrier 保留 message boundary。字节流 carrier 使用本提案规定的 length-prefix framing。

## Encoding

### CBOR subset

每个 frame 编码为一个 CBOR map，并满足 RFC 8949 Core Deterministic Encoding Requirements：

- integer 使用能够表示该值的最短 encoding；
- map key 按 deterministic encoding 排序；
- array、map、text 和 byte string 使用 definite length；
- 不使用 floating-point、undefined、indefinite length 或 CBOR tag；
- map key 只使用本协议定义的短 text string；
- integer 位于 `0..2^53-1`，以便常见 runtime 无损处理；
- text 必须是有效 UTF-8，不接受未配对 surrogate 的替代编码；
- 未在当前 frame schema 中允许的字段导致 frame-invalid，`x-` 扩展字段除外。

Plan digest 对规范化 agreement 去除 `digest` 字段后的 deterministic CBOR bytes 计算 SHA-256；计算结果再写入 `digest`。双方不能对包含 digest 自身的对象或各自语言对象的默认序列化结果计算 digest。

### Byte-stream framing

字节流中每个 CBOR frame 前置 4-byte unsigned big-endian length。Length 只计算 CBOR bytes，不包含 prefix。

读取方在分配 frame buffer 前检查 length：

- Hello 前采用本 profile 的 hard frame limit：1 MiB；
- Hello 后采用双方 limits 中较小的 `maxFrameBytes`；
- length 为 0 或超过 limit 时立即发送可行的 protocol close，并关闭 carrier；
- 不为 oversized frame 继续读取或丢弃声明长度的字节。

消息型 carrier 的一个 message 恰好包含一个完整 CBOR frame。空 message、多个 data item 或 trailing bytes 均为 frame-invalid。

## Frame envelope

```ts
interface ConnectionWireFrame<Body = unknown> {
  readonly wire: 'connection.cbor.dsh/v1alpha1'
  readonly type: ConnectionWireFrameType
  readonly sequence: number
  readonly connection?: string
  readonly body: Body
}
```

每个方向的 sequence 从 0 开始严格递增。重复、回退或空洞表示 wire violation。Sequence 只用于检测 frame stream 错位，不提供跨 carrier replay 或恢复。

除 `hello` 外，每个 frame 都携带双方确认的 connection id。Connection id 是当前 wire instance 的 opaque identity，不是 credential，也不在重新连接后复用。

```ts
type ConnectionWireFrameType =
  | 'hello'
  | 'hello-ack'
  | 'offer'
  | 'plan'
  | 'plan-accept'
  | 'plan-activate'
  | 'attachment-open'
  | 'attachment-data'
  | 'attachment-credit'
  | 'attachment-close'
  | 'ping'
  | 'pong'
  | 'close'
```

## Hello

Initiator 的首个 frame 必须是 sequence 0 的 hello：

```ts
interface HelloBody {
  readonly role: 'initiator'
  readonly connection: string
  readonly nonce: Uint8Array
  readonly endpoint: EndpointIdentity
  readonly limits: WireLimits
}

interface WireLimits {
  readonly maxFrameBytes: number
  readonly maxOfferBytes: number
  readonly maxAttachments: number
  readonly maxBufferedBytes: number
  readonly idleTimeoutMs: number
}
```

Connection id 使用至少 128 bit 随机值的无填充 base64url encoding。Nonce 恰好 32 bytes，并且每次 physical wire 唯一。

Acceptor 校验 wire version、carrier identity、limits 和 endpoint 后返回 hello-ack：

```ts
interface HelloAckBody {
  readonly role: 'acceptor'
  readonly nonce: Uint8Array
  readonly endpoint: EndpointIdentity
  readonly limits: WireLimits
}
```

Hello 中的 endpoint identity 是协议声明主体的逻辑 endpoint，不替代 carrier peer identity。Connection Host 把两者和 nonce 绑定到当前 wire audit context。

Wire version 不匹配时，Acceptor 可以发送不含敏感 detail 的 close；双方不在同一 byte stream 上尝试猜测另一 encoding。

## Offer and plan

### Offer

双方完成 hello 后交换完整 ConnectionOffer：

```ts
interface OfferFrameBody {
  readonly offer: ConnectionOffer
}
```

每个 offer revision 是完整替换。Frame size、declaration 数、participant 数和 protocol-specific spec 均先按协商 limit 校验，再交给 Connection evaluator。

收到更高 revision 不会立即改变 active plan。双方仍按旧 plan 处理 attachment，直到新 plan 激活。

### Plan

Negotiation coordinator 发送 candidate plan：

```ts
interface PlanFrameBody {
  readonly plan: ConnectionAgreement
}
```

接收方使用 plan 指定的 offer revision tuple、本地 protocol definitions 和显式 policy 重新计算。结果等价且 digest 相同时发送 plan-accept：

```ts
interface PlanAcceptBody {
  readonly planRevision: number
  readonly digest: string
}
```

Coordinator 自身也必须完成相同计算。双方 accept 后，Coordinator 发送 plan-activate。Activate 包含 plan revision、digest 和旧 plan 的 draining deadline。

未接受的 plan 不签发 attachment。新的 offer、definition error、digest mismatch 或 policy change 可以取消 candidate，但不能修改已经发送的同 revision plan。

### Renegotiation

任一方可以发送更高 revision 的完整 offer。每次只允许一个 candidate plan；Coordinator 按 offer revision tuple 确定性地丢弃过时 candidate。

旧 active plan 在新 plan activate 时进入 draining。Draining attachment 不接受新的领域 request；已经接纳的工作按所属协议规则结束或取消。

## Attachment

### Open

只有 active plan 中列出的本端 participant 可以请求打开 attachment：

```ts
interface AttachmentOpenBody {
  readonly attachmentId: string
  readonly planRevision: number
  readonly agreementId: string
  readonly localParticipant: string
  readonly remoteParticipant: string
  readonly codec: string
  readonly initialCredit: number
  readonly acknowledgement?: true
}
```

Attachment id 在 connection 内唯一且不复用。发起方省略 `acknowledgement`。接收方验证 agreement、participants、codec 和 attachment limit 后，以同 id 且 `acknowledgement: true` 的 attachment-open 接受；acknowledgment 不得再次触发 acknowledgment。拒绝使用 attachment-close 返回稳定 code。

`codec` 由领域协议 agreement 选择。Connection wire 不把未知领域 object 自动 CBOR 编码，也不存在默认的任意 RPC codec。

### Data

```ts
interface AttachmentDataBody {
  readonly attachmentId: string
  readonly messageSequence: number
  readonly payload: Uint8Array
}
```

每个方向的 message sequence 从 0 严格递增。Payload 是领域 codec 产生的一条完整 message；一条 attachment-data 不包含多条领域消息，也不拆分一条消息。

大对象和 byte stream 由 ContentStore 等领域协议分块。一条领域 message 仍受 frame 和 agreement limit；Connection 不为 oversized payload 进行隐式分片。

### Credit

Sender 只有在 payload bytes 不超过当前 credit 时才能发送 data。Receiver 消费已交付 message 后发送：

```ts
interface AttachmentCreditBody {
  readonly attachmentId: string
  readonly consumedThrough: number
  readonly grantBytes: number
}
```

Grant 增加可发送 byte credit。Credit 只计算 payload bytes；frame overhead 由 wire 全局 buffer limit控制。Sender 不能让 credit 变为负数，也不能把另一个 attachment 的 credit 挪用。

### Close

```ts
interface AttachmentCloseBody {
  readonly attachmentId: string
  readonly code: string
  readonly reason?: string
}
```

Close 是幂等 terminal frame。关闭后收到 data 或 credit 是 attachment violation。Plan draining deadline、participant lease 结束、permission 撤销和 connection close 都会关闭相应 attachment。

领域 error 应通过领域 message 返回。Attachment-close 只表示 attachment 本身无法继续，不把每次业务失败转换成 transport failure。

## Keepalive

任一方可以发送带 opaque token 的 ping，对方原样返回 pong。Ping/pong 不重置领域 deadline，也不证明远端业务 participant仍然可用。

双方采用 Hello limits 中较小的 idle timeout。Timeout 期间没有收到任何完整 frame时关闭 carrier。实现可以更早检测 carrier failure，但不能通过未协商的私有 keepalive frame 保持标准 connection。

## Connection close

```ts
interface ConnectionCloseBody {
  readonly code: string
  readonly reason?: string
  readonly lastPlanRevision?: number
  readonly acknowledgement?: true
}
```

正常关闭先发送不含 `acknowledgement` 的 close，停止打开新 attachment，关闭或 drain 既有 attachment，再关闭 carrier。Peer 以 `acknowledgement: true` 的 close 确认；acknowledgment 不得再次确认。Peer close 后不得发送除该 acknowledgment 外的新 frame。

Malformed CBOR、sequence violation、oversized frame、Hello mismatch、无效 plan activation 和持续 flow-control violation 可以立即关闭 carrier。Reason 面向诊断并受大小限制，不包含 credential、stack 或未裁剪领域 payload。

Carrier 异常断开等价于没有 acknowledgment 的 connection close。`v1alpha1` 不恢复原 connection id、plan、attachment 或进行中的领域 request。

## Local Host binding

独立应用进程使用相同 wire profile连接本地 Connection Host。Carrier 必须提供本地 peer authentication，例如 Unix peer credentials、Windows named-pipe client identity 或由父进程继承的已认证 stdio channel。

本地 connection 的 offer可以要求 `ConnectionService`，并发布应用实现的 Presentation 或其他领域 support。Host 依据本地 peer、启动 scope 和 policy 建立 proxy participant；wire 不提供“以任意 plugin id 注册 participant”的管理 frame。

Daemon socket 路径、named-pipe 名称、进程发现和自动启动属于产品 bootstrap。调用方一旦取得 carrier channel，协议行为与其他 EndpointConnection 相同。

## Errors

Wire close/attachment close code 至少区分：

- wire-version-unsupported；
- carrier-identity-unavailable；
- frame-invalid、frame-too-large 或 sequence-invalid；
- hello-invalid 或 connection-id-mismatch；
- offer-invalid 或 offer-limit-exceeded；
- plan-invalid、plan-digest-mismatch 或 plan-revision-invalid；
- agreement、participant 或 codec mismatch；
- attachment-limit-exceeded 或 attachment-closed；
- message-too-large、message-sequence-invalid 或 flow-control-exceeded；
- idle-timeout；
- policy-revoked；
- internal-wire-failure。

领域协议 error 不占用这些 code。

## Security considerations

- Wire 只接受 carrier 已认证的 peer；Hello endpoint identity 不替代认证。
- Nonce、connection id 和 sequence 绑定当前 physical wire，防止 frame 被误接到另一 connection；它们不是 cryptographic credential。
- Decoder 在分配前检查 length、nesting depth、collection length 和 text/byte limits。
- Deterministic CBOR 只解决一致编码，不提供加密、签名或认证。
- Offer 在进入 evaluator 前按 peer policy 裁剪，远端 participant identity 不是本地 principal。
- Attachment-open 同时验证 active plan、agreement 和双方 participant。
- Credit 与全局 buffer limit防止单个 attachment 无限占用内存。
- Close reason、diagnostic 和 protocol issue 不包含 credential、绝对路径、secret 或原始领域 payload。
- Content byte transfer 使用 ContentStore agreement 和 limits，不借 attachment-data 绕过对象大小或 retention policy。

## Relationship to other proposals

- Connection Service and Endpoint Protocol 定义 offer、agreement、plan 和 attachment 语义；本 profile规定其编码和 frame 顺序；
- Core 提供被 offer 携带的 protocol declaration；
- 各领域协议定义 attachment payload codec、request、event、cancel 和业务错误；
- ContentStore 对大对象进行有界分块，不依赖 wire 隐式分片；
- Carrier provider提供经过认证、可靠且有序的 channel；
- Permission 与 peer policy 决定哪些 declaration、attachment 和领域操作可以进入 wire。

## Rationale and alternatives

### 使用 JSON 作为唯一 wire encoding

JSON 没有原生 byte string，Content chunk 和领域 binary payload 需要额外 expansion。Deterministic CBOR 同时覆盖结构化 control frame 与 byte payload。

### 让 carrier 定义 frame

如果 WebSocket、QUIC、stdio 和 SSH 分别定义 negotiation 与 attachment，领域客户端会依赖 carrier。Carrier 只提供 channel；Connection wire 保持一致。

### 在 Connection 层提供任意 RPC

通用 method string 会绕过协议 agreement、message schema 和领域权限。Attachment payload 只由所选 codec 解释。

### 自动分片任意领域 message

隐式分片会让 Connection 承担未知对象的缓冲与重组。领域协议应设计有界 message；大字节对象使用 ContentStore。

### 在 Wire 内重新实现认证

SSH、TLS、QUIC 和本地 IPC 已具有不同认证机制。Wire 要求 carrier 提供绑定 identity，避免再发明一套与部署环境冲突的 credential handshake。

## Drawbacks

CBOR codec 和 deterministic encoding 比纯 JSON 实现复杂。

Connection Host 必须维护 offer/plan revision、双向 sequence、per-attachment credit 和 draining plan，而不只是转发 byte stream。

Profile 依赖已认证 carrier，不能直接用于任意裸 socket。

## Unresolved questions

### Logical resumption

`v1alpha1` 在 carrier 断开后重新执行 Hello、offer 和 negotiation。恢复 connection id、deduplicate 已接纳 request 和重建 stream 需要独立且可证明的 replay window，不能通过复用 sequence 猜测实现。

### Alternative mandatory codecs

本 profile 固定 CBOR。受限环境是否需要另一个标准 wire profile，应以独立实现无法采用 CBOR 的互操作证据为依据；不同 profile 不在同一 byte stream 上自动探测。
