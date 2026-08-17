# @dsh-std/manifest

DSH Standard 的静态 `manifest.yaml` 对象模型与 Component/Facet 校验器。`parseManifest()` 使用 YAML 1.2 解析单文档，再施加 manifest schema；`ManifestDefinitionCatalog` 生成带 validator、source、digest 与字段路径的结构化报告。

设计见 [Manifest 提案](../../docs/proposals/manifest.zh.md)。
