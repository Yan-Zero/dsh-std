# `@dsh-std/content` 设计提案

- 文档类型：设计提案
- 状态：草案
- 日期：2026-08-17

## Summary

`@dsh-std/content` 定义协议之间共享的文本 block、二进制 ContentReference，以及上传、读取和 retention 的 ContentStore 协议。

Agent、Session、Model、Presentation 和其他领域协议可以使用相同的 ContentReference，而不传递发送端文件路径、临时内存对象或任意 URL。

TypeScript 包使用 subpath 区分数据与 store client：

```ts
import { type ContentBlock, type ContentReference } from '@dsh-std/content'
import { contentStoreProtocol } from '@dsh-std/content/store'
```

协议 identity 为：

| `apiVersion` | `kind` | 含义 |
| --- | --- | --- |
| `content.dsh/v1alpha1` | `ContentStore` | Content metadata、上传、读取与 retention |

ContentBlock 和 ContentReference 是共享数据 vocabulary，不因出现在消息中就声明了 ContentStore support。

Content 不定义文件系统、目录树、文件编辑、远端 URL 下载、图片处理或 UI 渲染。

## Motivation

文本可以直接放入协议消息，图片、文件和其他二进制内容则不能安全地用本地路径表示：

- 路径只在创建它的 execution world 中有效；
- 远端客户端不应知道或猜测 Host 文件布局；
- 大对象不能无界地内联到 Session event 或 Connection frame；
- 上传完成不表示对象会在 Session 生命周期内一直存在；
- 同一对象可能被 Agent、Session 和 Presentation 共同引用；
- URL 会引入独立的网络访问、credential 和 server-side request forgery 风险。

ContentReference 提供稳定寻址，ContentStore 提供受限传输与 retention。领域协议继续拥有“这项内容为什么被使用”的语义。

## Roles

### Content provider

Content provider 拥有 content identity、metadata、字节存储、读取 policy 和 retention lease。它发布 `ContentStore` support。

Provider 可以使用内存、磁盘、对象存储或其他 backend；这些实现细节不进入 reference。

### Content producer

Producer 向 Store 上传字节，例如本地 UI staging 一张图片、工具产生一个 artifact 或 Model provider保存输出。Producer 只能请求 agreement 和 permission 允许的 media type、大小与 retention。

### Content consumer

Consumer 读取或引用 content。能够收到 ContentReference 不表示能够读取字节；Provider 在 describe、read 和 retain 时分别授权。

## Shared model

### ContentReference

```ts
interface ContentReference {
  readonly provider: string
  readonly id: string
}
```

`provider` 是当前 agreement 中的 Content provider participant identity。`id` 在 provider incarnation 内唯一，并且不是 path、URL、object-storage key 或 bearer token。

Reference 可以持久化到其他协议的数据中，但它自身不承诺 retention。持久 owner 必须取得相应 lease 或复制内容。

### Content metadata

```ts
interface ContentMetadata {
  readonly mediaType: string
  readonly size: number
  readonly digest?: ContentDigest
  readonly name?: string
  readonly createdAt?: string
}

interface ContentDigest {
  readonly algorithm: 'sha-256'
  readonly value: string
}
```

`mediaType` 使用规范化 MIME media type，不包含未经协商的参数。未知 media type 可以存储和转发，但 consumer 不必渲染或解释。

`name` 是不可信显示名称，不是路径。它不得包含目录分隔语义；Provider 和 UI 在展示或导出时重新清理。

`size` 和 digest 由 Provider 在接收完整字节后确认。Producer 提交的 metadata 只是预期值；不一致时 commit 失败。

### Content block

```ts
type ContentBlock = TextContentBlock | ReferencedContentBlock

interface TextContentBlock {
  readonly type: 'text'
  readonly text: string
}

interface ReferencedContentBlock {
  readonly type: 'content'
  readonly content: ContentReference
  readonly mediaType: string
  readonly name?: string
  readonly alt?: string
}
```

Text block 用于有界、可直接解释的 Unicode 文本。二进制内容和超过所属协议 inline limit 的文本使用 reference。

Referenced block 中的 metadata 是发送方为渲染提供的 snapshot。Consumer 在需要字节或权威 metadata 时调用 ContentStore.describe/read，不能依靠 message 中的 mediaType 绕过校验。

`alt` 是文本替代说明，不是对内容的可信解析结果。

## `ContentStore`

### Declaration

```ts
type ContentStoreOperation =
  | 'describe'
  | 'put'
  | 'read'
  | 'retain'
  | 'release'

interface ContentStoreRequirementSpec {
  readonly operations: readonly ContentStoreOperation[]
  readonly optionalOperations?: readonly ContentStoreOperation[]
  readonly mediaTypes?: readonly string[]
}

interface ContentStoreSupportSpec {
  readonly contentDomain: string
  readonly operations: readonly ContentStoreOperation[]
  readonly mediaTypes?: readonly string[]
  readonly maxObjectBytes: number
  readonly maxChunkBytes: number
  readonly retention: readonly ContentRetentionKind[]
}
```

省略 `mediaTypes` 表示 Provider 按 policy 接受任意 syntactically valid media type，不表示 consumer 能解释所有类型。

Agreement 记录 provider、clients、content domain、operations、media types、对象/分块大小和 retention kinds。Put 与 read 可以分别授权；只读 Provider 不发布 put。

### Describe

```ts
interface DescribeContentResult {
  readonly content: ContentReference
  readonly metadata: ContentMetadata
  readonly retention: ContentRetentionStatus
}
```

Describe 返回当前调用 scope 可见的权威 metadata，不读取内容字节。Reference 属于其他 provider、domain 或 agreement 时返回 reference mismatch。

对象不存在与调用者无权知道其存在，可以按照 disclosure policy返回相同外部 code；审计系统在本地保留真实原因。

### Put

Put 是有界、分阶段的提交：

```ts
interface BeginContentPutInput {
  readonly requestId: string
  readonly metadata: {
    readonly mediaType: string
    readonly size: number
    readonly digest?: ContentDigest
    readonly name?: string
  }
  readonly retention: ContentRetentionRequest
}

interface ContentUpload {
  readonly id: string
  readonly maxChunkBytes: number
  readonly expiresAt: string
}
```

Producer 调用 begin，按递增 sequence 发送 chunk，再 commit：

```ts
interface ContentChunk {
  readonly uploadId: string
  readonly sequence: number
  readonly bytes: Uint8Array
}

interface CommitContentPutInput {
  readonly uploadId: string
  readonly finalSequence: number
}

interface ContentPutResult {
  readonly content: ContentReference
  readonly metadata: ContentMetadata
  readonly lease: ContentLease
}
```

Provider 只在收到连续 sequence、精确 size、匹配 digest 并成功提交存储后返回 `ContentPutResult`。Result 中的 metadata 和 lease 是 Provider 接受的权威值；它们可以比 Producer 请求的约束更严格。未 commit、超时、取消或校验失败的 upload 不成为可引用 content。

相同 request id 与相同 metadata/retention 在 client scope 内返回同一已提交结果或同一进行中 upload；相同 id 与不同输入返回 conflict。

Chunk message 不携带本地路径。Connection profile 可以把 bytes 编码为原生 binary frame；不支持 binary frame 的编码必须有明确 expansion limit，不能无限 base64 缓冲。

### Read

```ts
interface OpenContentReadInput {
  readonly content: ContentReference
}

interface ContentRead {
  readonly id: string
  readonly metadata: ContentMetadata
  readonly maxChunkBytes: number
}
```

Read 先返回 metadata 与 read id，随后按连续 sequence 发送 byte chunk 和 terminal digest。Consumer 对总字节数和 digest 进行校验；Provider 不在 declared size 之外继续发送。

`v1alpha1` 只定义完整对象读取，不定义任意 byte range。Consumer 取消、agreement 失效或 flow-control deadline 到期会关闭 read，不影响对象本身。

读取 reference 不创建本地文件。Consumer 若要导出到 filesystem，必须通过独立 Filesystem capability 选择目标并执行写入。

### Retention

```ts
type ContentRetentionKind = 'invocation' | 'connection' | 'session' | 'persistent'

interface ContentRetentionRequest {
  readonly kind: ContentRetentionKind
  readonly owner?: ContentOwnerReference
}

interface ContentOwnerReference {
  readonly apiVersion: string
  readonly kind: string
  readonly reference: unknown
}

interface ContentLease {
  readonly id: string
  readonly content: ContentReference
  readonly kind: ContentRetentionKind
  readonly owner?: ContentOwnerReference
  readonly expiresAt?: string
}
```

Retention 表示 Provider 保留对象的最低生命周期：

- `invocation`：只保证到当前 invocation 结束；
- `connection`：保证到当前 connection 关闭；
- `session`：由经过验证的 SessionReference 拥有；
- `persistent`：不依赖当前 invocation、connection 或 Session。

Producer 请求的 kind 是上限请求，不是授权。Provider 可以拒绝或返回更短 retention；调用方只有接受明确结果后才能把 reference写入相应 owner。

`retain` 为已有 content 创建额外 lease。Owner reference 必须由 Host 根据调用 scope 验证；client 不能用任意 `{ kind, id }` 延长对象寿命。

`release` 只释放调用者拥有的 lease，并且幂等。对象仍有其他 lease 或 Provider policy 保留时不会删除。删除 Session 时，Session provider 释放对应 lease；普通 reader 无权释放 owner lease。

Reference 到期后返回 content-expired，不得被重新分配给另一对象。

## Ownership and deduplication

Provider 可以按 digest 去重，但两个相同字节的 put 仍可以产生不同 reference、permission 和 lease。Consumer 不能根据 digest 构造 reference或推断自己有权访问另一 owner 的对象。

Content 的业务所有权由引用它的领域协议决定。ContentStore 只维护字节和 lease，不判断一张图片是 user input、tool output 还是 Session attachment。

## Connection binding

ContentStore 可以在进程内由 scoped SDK 使用，也可以在 `@dsh-std/connection` attachment 上运行。Connection agreement 绑定 provider、clients、content domain、operations 与 limits。

Metadata/control message 与 byte chunk 使用同一 ContentStore agreement，但实现可以映射到不同 carrier stream。Connection Host 负责 attachment flow control，不读取 content 字节或把 upload id 当作文件路径。

Put/read stream 终止不会关闭整个 connection。Connection 关闭会取消 connection-scoped upload、read 和 lease；更长 retention 的已提交对象仍按 ContentStore 规则存在。

## Errors

协议错误至少区分：

- provider 或 content domain 不匹配；
- operation 或 media type 未协商；
- content 不存在、已过期或不可访问；
- metadata、size、digest 或 name 无效；
- object、chunk、并发 stream 或 buffer limit 超出；
- upload/read id 无效、过期或不属于当前 client；
- chunk sequence 缺失、重复或越界；
- commit size 或 digest mismatch；
- retention kind 不支持或 owner 无效；
- lease 不属于调用者；
- permission 或 policy 拒绝；
- provider unavailable、存储失败或 flow control exceeded。

错误 detail 不包含对象字节、底层路径、object-storage credential、签名 URL 或未裁剪产品 stack。

## Security considerations

- ContentReference、upload id、read id、digest 和 lease id 都不是可互换的授权凭据。
- Provider 对 describe、put、read、retain 和 release 分别授权。
- Producer 声明的 media type、name、size 和 digest 均为不可信输入，Provider 在 commit 时确认。
- Consumer 不根据 media type 自动执行脚本、宏、HTML、SVG active content 或操作系统 opener。
- URL 不是 ContentReference；远端 URL 获取需要独立 network capability 与 policy。
- Local path 不进入 Content message。导入文件时，拥有 filesystem permission 的本地 component 读取字节后执行 put。
- Secret、credential 和 private key 不使用普通 ContentStore，除非有独立 secret-storage profile 明确覆盖零化、访问和审计语义。
- Provider 限制对象大小、chunk 大小、并发 stream、未提交 upload、retention 数和总存储配额。
- Session 或 Agent 中出现 ContentReference 不扩大当前 client 的 read permission。

## Relationship to other proposals

- Core 声明并协商 ContentStore；
- Connection 承载 metadata、控制消息和有界 byte stream；
- Agent input/output 使用 ContentBlock，不传本地文件路径；
- Session event 可以持久化 ContentReference，并取得 Session retention lease；
- Model request/response 可以复用相同 ContentBlock；
- Presentation 可以展示经授权的 referenced content，但 SecretInput 不进入 ContentStore；
- Filesystem 负责路径、目录和文件读写，ContentStore 负责独立对象与跨协议引用；
- Permission 决定 transfer、media type、retention、owner 与实际读取范围。

## Rationale and alternatives

### 在每个领域协议中各定义附件

Agent、Session 和 Model 若各自定义上传和 reference，会产生不能共享的 identity、重复字节和不一致 retention。公共 Content vocabulary 允许领域协议只定义用途。

### 直接传文件路径

路径只在一个 execution world 中有效，并可能泄露 Host 布局。它也不能提供跨 Session retention 或远端读取授权。

### 使用 URL

URL 把网络访问、credential、过期和 SSRF policy混入所有 consumer。ContentReference 由已协商 Provider 解析，不要求 consumer 发起任意网络请求。

### 在普通协议消息内联所有字节

无界内联会阻塞控制 frame、破坏 flow control 并放大持久 event。ContentStore 使用有界 chunk 和独立 retention。

### Digest 作为 identity

相同字节可以属于不同 owner 与 permission scope。Digest 用于完整性和可选去重，不承担授权 identity。

### ContentStore 直接管理文件系统

内容对象没有目录、相对路径、symlink 或原地编辑语义。导入和导出由 Filesystem capability 显式完成。

## Drawbacks

发送一张小图片也需要上传与 reference 两步，并维护额外 lease。

Provider 必须实现有界 stream、digest 校验、未提交 upload 清理和 retention accounting，而不只是保存 byte array。

ContentReference 的可用性依赖 Provider 与 lease；离线导出器可能需要显式复制所引用内容。

## Unresolved questions

### Inline binary threshold

`v1alpha1` 不在 ContentBlock 中定义 inline binary。是否允许极小对象以内联形式出现，需要结合 Connection frame limits 和 Session persistence 成本判断。

### Cross-provider copy

在不把所有字节拉回 client 的情况下，从一个 Content provider 复制到另一个 provider，需要双方认证和 delegation。普通 reference 不能授权 server-to-server fetch。

### Streaming generated content

Model 或 tool 在生成过程中产生未知最终大小的对象时，是否允许 size 未知的 put profile，需要独立的 quota、abort 和 digest 规则。
