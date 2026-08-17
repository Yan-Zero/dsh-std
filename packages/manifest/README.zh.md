# @dsh-std/manifest

Community v0.15 `dsh-plugin.json` 的静态对象模型、JSON Schema、校验器和 Host 内部投影。内置解析器由 `manifestVersion` 选择；`parseManifest()` 只要求 `$schema` 是绝对 URI，不把它绑定到不存在的 canonical URL，也不联网获取 schema。

本包通过 `@dsh-std/manifest/schema/dsh-plugin-0.15.schema.json` 导出本地草案 schema。它是随包发布的校验资源，不表示 community#24 已经指定 canonical schema URI。
