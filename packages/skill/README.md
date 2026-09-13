# @dsh-std/skill

English | [中文](README.zh.md)

Portable declaration and publication contract for lazily loaded Skill instruction assets.

A `skills.dsh/v1alpha1` `Skill` extension declares a kebab-case name, a short catalog description, a package-relative UTF-8 Markdown entry, and optional model/user invocation visibility. Activation publishes the resource with the exported inert `null` marker, not an executable callback. The protocol does not prescribe a product's prompt assembly, cache, precedence ranks, filesystem layout, or agent loop.

The Host resolves the entry against the package containing `dsh-plugin.json`, reads the body only when requested, and retracts the catalog entry with its owning activation instance. Same-name effective resources conflict through the standard composition rules.

DeepSeek Harness mapping is supplied automatically by `@dsh-std/adapter-dsh`; portable components do not import DSH or Cordis packages.
