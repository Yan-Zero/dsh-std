# `@dsh-std/skill` 设计提案

- 文档类型：设计提案
- 状态：草案
- 日期：2026-09-13

## Summary

`@dsh-std/skill` 定义 `skills.dsh/v1alpha1` `Skill` resource。组件以静态 extension 声明可发现的 Skill 元数据与 package 内 Markdown 入口；Host 只在实际请求 Skill 时读取正文，并以 activation instance 为该目录项的生命周期所有者。

本协议不定义 AgentLoop、prompt 拼装、自动触发、记忆、缓存算法、provider 优先级或产品内部 Skill registry。

## Motivation

Tool 与 Skill 经常由同一个组件共同提供：Tool 暴露可执行动作，Skill 则提供使用这些动作的结构化指导。缺少可移植 Skill resource 时，组件即使已经用标准协议发布 Tool，仍必须直接依赖某一产品的 Skill registry，Skill-only 组件也无法迁移。

Skill 的目录元数据需要静态可分析，而正文可能较大，且只有实际调用时才有读取价值。因此本协议把静态发现与正文加载分开，并让 Host 保有 package 路径校验、调用策略和 prompt 组装权。

## Protocol boundary

本协议规定：

- Skill 的稳定名称、目录描述和入口；
- model 与 user 两类 invocation 可见性；
- package 内入口解析和按需读取；
- resource publication 协商；
- 同名资源冲突、activation 生命周期和加载失败行为。

本协议不赋予组件读取任意文件、修改会话、追加事件或执行工具的权限。Skill 正文只是 Host 可以提供给既有调用流程的指令内容。

## Roles and terminology

- **Skill contributor**：在 Manifest 中声明 Skill resource 的 component facet。
- **Skill host**：接受 resource publication、维护目录并按需读取正文的 participant。
- **Skill consumer**：按产品 policy 发现或请求 Skill 的模型侧或用户侧调用方。

- **Skill resource**：Manifest 中 `apiVersion + kind + metadata + spec` 组成的静态声明。
- **Catalog metadata**：无需读取正文即可展示或用于路由的名称、描述与 invocation policy。
- **Entry**：相对于包含 Manifest 的 package 根目录解析的 UTF-8 Markdown 文件。
- **Body**：读取 Entry 得到的完整文本。
- **Owning activation**：使某项 Skill publication 生效的 activation instance。

## Guide-level explanation

组件在静态 Manifest 中声明 Skill 的名称、描述与正文入口。Facet activation 不需要读取正文，也不为静态 Skill 发布可执行 handler；它只通过 lifecycle publication API 提交协议定义的惰性 `null` marker。该 marker 越过 publication barrier 后，Host 才把元数据加入目录；只有 consumer 请求该 Skill 时才读取入口文件。

### Skill resource

协议坐标为：

```ts
const API_VERSION = 'skills.dsh/v1alpha1'
const KIND = 'Skill'
```

Resource 数据模型为：

```ts
interface SkillResource {
  readonly apiVersion: 'skills.dsh/v1alpha1'
  readonly kind: 'Skill'
  readonly metadata: {
    readonly name: string
  }
  readonly spec: {
    readonly description: string
    readonly entry: string
    readonly invocation?: {
      readonly model?: boolean
      readonly user?: boolean
    }
  }
}
```

`metadata.name` 必须（MUST）是由小写 ASCII 字母、数字和单连字符分隔段组成的 kebab-case 名称。`description` 必须（MUST）是非空的简短路由描述。

`entry` 必须（MUST）是使用 `/` 分隔的 package-relative portable path。它不得（MUST NOT）是绝对路径，不得包含空段、`.`、`..`、反斜杠或 NUL；每段只能包含 ASCII 字母、数字、点、下划线和连字符。

`invocation.model` 表示 Skill 是否可以出现在面向模型的发现或加载界面；`invocation.user` 表示是否可以被用户显式调用。字段缺省时值为 `true`。两者不得（MUST NOT）同时为 `false`。

### Manifest contribution

支持 namespaced contribution point 的 Manifest 可以把 Skill 声明投影为 extension。例如 Community v0.15 可以使用其 `x-*` contribution lane：

```json
{
  "contributes": {
    "x-dsh-std.skills": [
      {
        "id": "example.component.let-me-lsd",
        "apiVersion": "skills.dsh/v1alpha1",
        "kind": "Skill",
        "name": "let-me-lsd",
        "spec": {
          "description": "Use bounded divergent cognition followed by convergence.",
          "entry": "skills/let-me-lsd/SKILL.md"
        }
      }
    ]
  }
}
```

Manifest projection 必须（MUST）保留 extension 的 owning component、facet 和 package root 来源。Package root 是 Host 从已安装 artifact 得到的可信位置，不是 Skill spec 提供的路径。

Activation publication 的 handler 值必须（MUST）是 `null`。它只证明 owning activation 显式发布了静态 resource，不包含 loader、callback 或正文。Manifest 声明本身不得（MUST NOT）绕过 publication barrier 自动成为 live Skill。

## Reference-level explanation

### Lazy loading

Host 在目录发现阶段不得（MUST NOT）为了列出 Skill 而读取 `entry` 正文。目录项必须（MUST）仅由静态 resource 和 activation provenance 形成。

Host 在调用方请求一个当前可见的 Skill 时必须（MUST）：

1. 重新确认 owning activation 仍然 active；
2. 将 `entry` 解析到该 resource 所属 package 根目录；
3. 拒绝任何词法解析或符号链接解析后逃逸 package 根目录的目标；
4. 以 UTF-8 读取完整 Markdown body；
5. 在完成读取后再次确认 publication 仍然有效，失效时不得返回旧 body。

Host 可以（MAY）缓存目录或正文，但缓存不得（MUST NOT）使已经撤销的 publication 继续可见。缓存 key 至少必须（MUST）区分 owning activation instance；不得只以 Skill name 复用不同 owner 的内容。

实现不得要求（MUST NOT）组件在 activation 时预先读取或注入正文，也不得要求修改 AgentLoop。产品可以根据自己的调用入口、policy 和 prompt contract 使用加载结果。

### Negotiation

`skills.dsh/v1alpha1` `Skill` requirement 与 support 不接受 `spec`。Support 表示 participant 能够接收并拥有该 resource publication。

每个 required consumer 必须（MUST）存在另一个 participant 提供 support；否则协商失败。Optional requirement 缺少 support 时产生 warning，但不得形成可用 agreement。

成功 agreement 的数据为：

```json
{ "kind": "ResourcePublication" }
```

注册 protocol definition 只表示 Host 理解该坐标，不表示 Host 已提供 support。实现不得（MUST NOT）仅因能够校验 Skill spec 就宣称可以发布或加载 Skill。

### Composition and lifecycle

同一 composition scope 内，两个有效 owner 不得（MUST NOT）同时拥有相同 `metadata.name` 的 `Skill`。发现冲突时 composition 必须（MUST）以 `extension-conflict` 失败，而不是按照安装顺序、扫描顺序或产品 provider rank 静默选择。

Skill 只能在 owning activation 越过 publication barrier 后进入目录。Activation 失败、回滚或卸载时，Host 必须（MUST）同步撤销目录项并使后续加载返回不可用。正在进行的读取可以完成底层 I/O，但在 publication 已失效时不得返回 body。

产品内部的 scope shadowing 或 provider precedence 可以处理非标准 Skill 来源；它不得改变标准 Skill resources 之间的上述冲突语义。

### Errors

实现至少必须区分以下失败类别；具体产品 API 可以采用自身的 error envelope：

- resource schema 或名称无效；
- required resource-publication support 缺失；
- 同名 Skill owner 冲突；
- package-root provenance 缺失；
- entry 不存在、不是可读取文件或不是有效 UTF-8 文本；
- entry 经解析后逃逸 package 根目录；
- 请求取消或 owning activation 已失效。

加载失败不得（MUST NOT）返回部分正文，也不得回退读取同名但来自另一 owner 的文件。

## Security considerations

Skill body 会影响模型行为，Host 应当（SHOULD）在安装、目录和诊断界面保留并展示 component、version、facet 与 artifact provenance。Skill 的可发现性不等于其来源可信。

Host 必须（MUST）在跟随符号链接后重新执行 package containment 检查。仅删除字符串中的 `..` 不足以建立文件边界。

实现应当（SHOULD）设置正文大小、读取时间和并发限制。取消信号应当（SHOULD）传播到文件读取。正文中的相对资源引用不自动获得 package 外文件访问、网络访问或工具执行权限。

## Compatibility

`v1alpha1` consumer 必须把省略的 `invocation.model` 与 `invocation.user` 解释为 `true`。这保证只声明 `description + entry` 的早期组件仍同时出现在 model 与 user discovery 中。

新增可选 catalog metadata 不得改变旧 resource 的 entry 解析或默认 invocation 行为。改变名称语法、入口含义、默认可见性、冲突规则或 package containment 边界需要新的协议版本，并由相应 protocol definition 明确声明兼容关系。

## Relationship to other proposals

Manifest 负责静态发现与 package provenance，composition 负责 effective owner 冲突，lifecycle 负责 publication barrier 与撤销。Core 只协商 `Skill` resource publication，不解释 Skill 字段。Tool、Command、Session 和 Presentation 均不是本协议的必需依赖。

## Rationale and alternatives

### 把完整正文放入 Manifest

这会扩大安装时解析与目录枚举成本，也会使只想读取 metadata 的市场或 Host 被迫处理完整指令。Package-relative entry 保持 Manifest 惰性且可审计。

### 让组件在 activation 时注册产品 Skill

这会把产品 registry、scope 和 disposer 类型泄漏给可移植组件。由 Host 映射静态 resource，可以在不改变组件代码的情况下适配不同产品。

### 按 provider rank 处理标准 Skill 重名

Rank 是产品内部优先级，不是跨实现可判定的 owner 选择规则。标准 resources 的重名必须在 composition 阶段显式失败；产品仍可对非标准来源使用自己的优先级。

## Drawbacks

严格的 portable path 语法不接受带空格或非 ASCII 字符的入口名。正文按需读取也意味着缺失或损坏的 asset 可能在安装和激活之后、首次调用时才暴露；Host 应通过 artifact 校验或诊断工具提前报告这类问题。

## Unresolved questions

### Additional body formats

`v1alpha1` 只定义 UTF-8 Markdown。是否需要在后续版本支持其他媒体类型，应由真实 consumer 能力和安全边界决定，不能从文件扩展名自动推断。
