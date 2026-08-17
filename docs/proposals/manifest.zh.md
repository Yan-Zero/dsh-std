# `@dsh-std/manifest` 设计提案

## 摘要

`@dsh-std/manifest` 定义插件包根目录中的静态 `dsh-plugin.json`。文件格式遵循 [community#24](https://github.com/omdsh-dev/community/issues/24) 与其 RFC 0001 草案：插件代码执行前，Host 必须能够识别插件、校验清单、判断 Host API 与 capability 兼容性，并读取 entrypoint、permission、subscription 和 contribution 声明。

Manifest 是安装与协商输入，不是运行时可用性证明。插件已经声明某项 contribution，不表示 handler 已经绑定；Host 声明某项 capability，也不表示用户已经授权。

## 文件与 schema

发现文件名固定为 `dsh-plugin.json`。Host 不把 `manifest.yaml`、`plugin.json`、`package.json` 字段或执行 JavaScript 得到的对象视为该标准清单。

根对象必须包含 `$schema`。Host 只使用随自身安装的 schema registry 解析该 identifier，不在加载插件时访问网络。已发布的 canonical identifier 不得指向另一份内容。

RFC 0001 尚未发布正式 canonical schema。当前包随附的实现草案使用：

```text
urn:dsh-std:draft:dsh-plugin:0.1.0
```

这个 URN 表示 dsh-std 对社区草案的实验实现，不冒充社区已经冻结的 identifier。社区 schema 发布后，应增加新的 identifier 与显式迁移，不得静默改变该 URN 的含义。

## 对象模型

```ts
interface PluginManifest {
  readonly $schema: 'urn:dsh-std:draft:dsh-plugin:0.1.0'
  readonly manifestVersion: '0.1.0'
  readonly id: string
  readonly name: string
  readonly version: string
  readonly apiVersion: string
  readonly entrypoints: { readonly host: string }
  readonly capabilities?: {
    readonly required?: Readonly<Record<string, string>>
    readonly optional?: Readonly<Record<string, string>>
  }
  readonly permissions?: readonly PermissionRequest[]
  readonly subscriptions?: readonly EventSubscription[]
  readonly contributes?: Readonly<Record<string, readonly unknown[]>>
}
```

最小示例：

```json
{
  "$schema": "urn:dsh-std:draft:dsh-plugin:0.1.0",
  "manifestVersion": "0.1.0",
  "id": "com.example.hello",
  "name": "Hello",
  "version": "1.0.0",
  "apiVersion": ">=0.1.0 <0.2.0",
  "entrypoints": { "host": "example-hello/host" },
  "capabilities": {
    "required": { "commands": ">=0.1.0 <0.2.0" }
  },
  "contributes": {
    "commands": [
      { "id": "com.example.hello.say-hello", "title": "Say hello" }
    ]
  }
}
```

## 版本字段

以下版本轴相互独立：

| 字段 | 含义 |
| --- | --- |
| `version` | 插件发行物的 SemVer 版本 |
| `manifestVersion` | JSON 清单结构版本；必须与 `$schema` 一致 |
| `apiVersion` | 插件要求的 Host API SemVer 范围 |
| capability/subscription 中的范围 | 单项 contract 的兼容范围 |
| Host product version | GUI、Web、TUI 或其他宿主的产品版本，不进入插件 `apiVersion` |
| SDK package version | 开发库版本，不等于 Host API 版本 |

`apiVersion` 不再承担 manifest schema identity。协议包内部使用的 `models.dsh/v1alpha1` 等 contract identifier 也不能写入这个字段。

## Entry point

v0.1 只定义 Host-side Node.js entrypoint：`entrypoints.host`。路径必须解析到当前 package 内，不能是绝对路径，也不能通过 `..` 离开 package。

Host 可以用自己的 loader、module resolver 和生命周期实现装载 entrypoint。插件 entrypoint 只依赖标准 SDK 与协议 contract，不依赖 DSH、Cordis 或 DSH adapter。

## 声明分类

Manifest 保持以下语义边界：

- `capabilities.required`：缺失时拒绝激活；
- `capabilities.optional`：缺失时只能走已声明的降级路径；
- `permissions`：Host 支持不等于已经授权；
- `subscriptions`：控制 eager activation 后的事件投递，不是激活触发器；
- `contributes`：代码执行前可发现的静态产品元数据；
- `provides`：保留给后续 service composition，当前 schema 拒绝。

同一 capability 不能同时出现在 required 与 optional。声明 command contribution 的插件必须同时要求 `commands` capability。

## Contributions

社区 v0.1 的 `commands` contribution 是 flat action leaf。每个全局 ID 对应一个 handler；manifest 不表达 command tree、subcommand、CLI options、交互式 prompt 或流式输出。

dsh-std 仍有尚未进入社区 v0.1 的 ModelProvider、Tool 等实验协议。它们暂时通过私有 contribution point `x-dev.dsh-std.extensions` 表达：

```json
{
  "id": "com.example.provider.main",
  "apiVersion": "models.dsh/v1alpha1",
  "kind": "ModelProvider",
  "name": "example-provider",
  "spec": {}
}
```

该私有 contribution point 不是社区标准能力。Host 不理解它时不能声称对应 contribution 已生效。

## Host 内部投影

dsh-std 现有 Composition 与 Lifecycle 实现仍以 activation participant 为内部单位。`projectManifest()` 会把一个 `dsh-plugin.json` Host entrypoint 投影为一个内部 activation unit，以复用现有 publication barrier、ownership 和清理逻辑。

这个投影不是第二种发布格式：

- package 不携带 Component/Facet manifest；
- 插件代码看不到投影对象；
- adapter 不能要求插件了解投影中的内部 identity；
- 后续替换内部 Composition 实现不能改变 `dsh-plugin.json` contract。

## 校验与失败

`parseManifest()` 只接受 JSON，并返回递归冻结的对象。至少检查：

- `$schema` 与 `manifestVersion`；
- 插件 ID、插件 SemVer 和 Host API range；
- package-relative Host entrypoint；
- required/optional 重复；
- subscription 与 contribution ID 重复；
- 未定义的非 namespaced contribution point；
- v0.1 禁止的顶层字段，例如 `provides`。

解析、schema、兼容性或授权失败都必须发生在执行 entrypoint 之前。Host 不得保存未知标准字段后把它展示为已经支持。

## 未决事项

- 社区正式 canonical schema identifier 与不可变 schema hash；
- permission 的首批具体 scope schema；
- Host Descriptor 与 Capability/Event Registry 的发布位置；
- `x-dev.dsh-std.extensions` 中各实验协议迁移到正式 contribution/provider contract 的方式；
- npm metadata 与 manifest 重复字段的权威来源及一致性诊断。
