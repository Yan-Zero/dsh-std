# `@dsh-std/manifest` 设计提案

- 文档类型：设计提案
- 状态：方向已确认，格式草案
- 日期：2026-08-17

## Summary

`@dsh-std/manifest` 定义插件包根目录中的静态 `dsh-plugin.json`。Manifest 在执行插件代码前声明包身份、facets、协议要求、权限、订阅和静态贡献。

Manifest 使用 `$schema` 和 `manifestVersion` 标识结构版本。Host 可以识别多个 Manifest 版本，并把它们投影为共同的 component、facet 和 protocol declaration 语义。支持一个版本不表示必须支持其他版本。

Manifest 是安装与协商输入，不是运行时可用性证明。静态声明的 requirement、support 或 contribution 只有经过协议校验、composition、activation 和 publication 后，才能形成相应的运行时事实。

## Motivation

插件身份、入口和兼容要求必须能够在不执行代码的情况下读取。否则市场、安装器和 Host 只能在激活后发现能力缺失、权限不足或 contribution 冲突。

Manifest 结构也会随协议发展而增加 facets、契约坐标和新的扩展点。版本字段使旧格式可以继续被明确识别，而不是让 Host 根据字段外观猜测语义。各 Manifest 版本最终投影到相同的组合模型，使 lifecycle 和领域协议不依赖某一版 JSON 字段名。

## Guide-level explanation

### Discovery

插件包根目录至多有一个 `dsh-plugin.json` 作为本标准的发现入口。Host 不把 `package.json` 字段、其他文件名或执行 JavaScript 后得到的对象自动视为等价 Manifest。

Manifest 必须是静态 JSON。Host 在读取包身份、声明和兼容要求时不得执行插件代码，也不得根据 `$schema` URL 临时下载并执行解析逻辑。

### Manifest version

`$schema` 标识对应版本的静态 schema，`manifestVersion` 标识 Manifest 结构版本。两者必须一致。一个已经发布的 schema identifier 不得在原位置改成另一份结构。

Host 只解析自己明确支持的 Manifest 版本。未知版本返回 manifest-version-unsupported；Host 不能把它退回到较旧 schema，也不能忽略新版本中的 required 字段继续激活。

旧版本可以由同一 Host 继续支持。版本之间的字段转换必须是确定性的，并在校验结果中保留原始版本与输入 digest。

### Component and facets

一个 Manifest 描述一个可分发 component。Component 可以包含一个或多个 facets；每个 facet 是独立的静态声明与激活边界。

Facet 至少可以声明：

- activation entry；
- protocol requirements；
- potential protocol supports；
- permissions；
- subscriptions；
- static extensions。

某个 Manifest 版本可以只定义其中一部分。例如只定义 `host` facet 的版本不因此为 `client` 或 `worker` 规定隐式行为。Host 不能从 facet 名称猜测执行位置、UI 或 transport；这些语义由 activation 与领域协议规定。

### Protocol references

协议引用使用 `apiVersion + kind`。Manifest schema 只校验坐标外壳；协议专属 `spec` 由相应 `ProtocolDefinition` 校验。

协议 group 不必先进入某个公共目录才能出现在 Manifest。Host 若取得相应 definition，就按 core 规则校验和协商；未取得 definition 时，required requirement 阻止兼容，optional requirement 被报告为未满足。未知 support 不构成可用实现。

Manifest 中的 potential support 只是 facet 可以发布的静态上限。Facet 激活后仍必须在 activation scope 内登记 implementation，并越过 publication barrier，才能产生 live support。

### Extensions

Manifest 版本可以规定 namespaced 字段或 contribution point。Host 不理解某项扩展时，可以按该扩展点的规则保留或忽略它，但不能声称对应功能已经生效。

扩展字段本身不能暗含 required 行为。会影响兼容性、激活、权限或运行时调用的内容必须表达为 protocol requirement/support、activation、permission、subscription 或带 definition 的 extension。

组织自用协议和实验协议使用与其他协议相同的声明、协商和生命周期语义。它们是否被某份公共标准收录，只影响相应的兼容声明，不改变 core 对坐标的处理。

## Reference-level explanation

### Community v0.15 structure

Host 对 Community v0.15 Manifest 的支持至少涵盖以下结构：

```ts
interface CommunityPluginManifestV015 {
  readonly $schema: string
  readonly manifestVersion: '0.15'
  readonly id: string
  readonly name: string
  readonly version: string
  readonly facets: {
    readonly host: {
      readonly entry: string
      readonly apiVersion: string
    }
  }
  readonly requires: {
    readonly contracts: readonly CommunityContractReference[]
  }
  readonly permissions: readonly unknown[]
  readonly contributes: Readonly<Record<string, readonly unknown[]>>
  readonly subscriptions: readonly unknown[]
  readonly license?: string
  readonly source?: unknown
  readonly artifact?: unknown
}

interface CommunityContractReference extends ApiReference {
  readonly optional?: boolean
  readonly fallback?: string
}
```

该结构按以下规则进入共同组件模型：

- `id`、`name`、`version`、`license`、`source` 和 `artifact` 形成 component metadata；
- `facets.host.entry` 形成 `host` facet 的 activation；
- `facets.host.apiVersion` 约束该 activation API，不作为领域协议版本；
- `requires.contracts` 形成 protocol requirements；
- `permissions` 由对应 permission definitions 解释；
- `contributes.commands` 形成没有子命令的 `Command` extensions；
- coordinate subscription 直接形成 event subscription；字符串形式必须通过该版本定义的稳定别名表解析为唯一坐标；
- `compat`、`overrides` 和其他已声明的安装信息进入 admission 或 provenance，不产生 live support；
- 该版本没有 potential support 声明时，不为 facet 补造 `protocols.supports`。

通过 Manifest schema 只证明文件结构有效。Host 是否能够激活插件，仍取决于 activation API、required protocols、permission policy 和领域实现。

### Projection result

Manifest 校验成功后产生一个规范化的 component declaration，至少包含：

- 原始 Manifest 版本、schema identifier 和内容 digest；
- component identity 与 metadata；
- facets 及其 activation；
- protocol requirements 与 potential supports；
- permissions、subscriptions 和 extensions；
- 每个规范化项目对应的原始 JSON path；
- 未解释、已忽略或仅保留的 namespaced extensions。

Projection 不是第二种包内 Manifest。Composition、lifecycle 和 provenance 消费该结果，不要求插件发布内部对象格式。

相同输入、相同 Manifest version definition 和相同协议别名表必须产生等价 projection。转换不能取决于对象属性顺序、包发现顺序或已经激活的插件。

### Definition availability

Manifest schema definition 解释文件结构；protocol definition 解释协议专属声明。二者不能互相代替。

Host 必须在解释 protocol `spec` 前取得相应 definition。Definition 可以由 Host 内建、随 profile 安装、由显式配置选择，或来自满足 Host policy 的协议包。注册 definition 不产生 live support，也不授予权限。

同一坐标存在内容不一致的 definitions 时，校验失败。Host 不能以 registry、package 或注册顺序选择其中一份。

### Validation result

校验结果至少包含：

- Manifest version 与 schema identifier；
- source URI 和内容 digest；
- component identity；
- projection digest；
- validator identity；
- warning/error 的稳定 code、JSON path 和说明；
- 未知 required/optional protocols；
- 未解释的 extensions。

失败必须区分 JSON/schema 错误、版本不支持、projection 错误、protocol definition 不可用、activation API 不可用和 contribution 冲突。

Permission 未授权、required live support 缺失和 activation failure 不属于 Manifest 语法错误；它们分别由 permission、composition 和 lifecycle 报告。

## Security considerations

Manifest 静态可分析不构成代码隔离。可信进程内插件仍可能绕过声明访问进程能力；permission 和 provenance 不能替代 sandbox。

Schema identifier 不是可信代码来源。Host 不得在解析任意插件时按插件提供的 URL 下载并执行 schema、definition 或 validator。

Artifact digest 证明指定字节内容，不证明发布者身份。来源、签名、attestation 和 conformance claim 是不同事实。

## Rationale and alternatives

### 只接受最新 Manifest 版本

这会迫使现有插件在字段语义未改变时同步迁移，也会把兼容转换散落到各产品 loader。明确支持的旧版本可以通过确定性 projection 进入同一组件模型。

### 接受所有未知字段

未知字段可能包含 required 行为。只有 Manifest version 明示的 extension point 才能保存未知 namespaced 内容；行为语义必须通过已识别的协议或扩展定义表达。

### 由 core 解析 Manifest

包发现、JSON schema、entrypoint 和分发 metadata 不属于协议协商。Core 只处理投影后的 protocol declarations。

### 把静态 support 当作实现

静态声明不能证明 handler 已绑定或配置已启用。Potential support 只用于 preflight；live support 来自 activation publication。

## Unresolved questions

### Shared metadata

License、source、artifact、override 和安装影响字段中哪些应在所有 Manifest 版本间采用共同结构，取决于相应 schema 是否已经具有跨实现语义。
