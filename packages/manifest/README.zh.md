# @dsh-std/manifest

社区插件草案的静态 `dsh-plugin.json` 对象模型、JSON Schema 与校验器。`parseManifest()` 不执行插件代码或联网取 schema；`projectManifest()` 只为当前 Host 内部的 Composition/Lifecycle 生成临时投影。

当前 canonical identifier 是 dsh-std 自有的实验 URN，不代表 community#24 已经冻结正式 schema。
