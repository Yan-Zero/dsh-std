# @dsh-std/skill

[English](README.md) | 中文

可移植、按需加载的 Skill 指令资源声明与发布协议。

`skills.dsh/v1alpha1` `Skill` extension 声明 kebab-case 名称、简短目录描述、package 内 UTF-8 Markdown 入口，以及可选的 model/user invocation 可见性。Activation 使用包导出的惰性 `null` marker 发布该资源，不携带可执行回调。协议也不规定产品的 prompt 组装、缓存、优先级 rank、文件系统布局或 AgentLoop。

Host 以 `dsh-plugin.json` 所在 package 为根解析入口，只在请求 Skill 时读取正文，并随所属 activation instance 撤销目录项。相同名称的有效资源按标准 composition 规则产生冲突。

DeepSeek Harness 映射由 `@dsh-std/adapter-dsh` 自动提供；可移植组件不导入 DSH 或 Cordis 包。
