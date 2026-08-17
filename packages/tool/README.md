# @dsh-std/tool

English | [中文](README.zh.md)

Runtime discovery contract for model-facing tools.

## Contract

A `Tool` resource declares a title, localized titles, and a catalog description. Runtime-owned status reports whether the tool is `available` or `unavailable`. An available tool may project its resolved model description and inert JSON Schema parameters; an unavailable tool may explain why it cannot be used.

The static extension records its component and facet owner. Status answers what the active runtime can expose for the current composition. This separation supports progressive disclosure without claiming that every installed tool is active or sending executable validators across endpoints.

The contract describes discovery only. Tool invocation, streaming, approval, sandbox policy, and model transcript semantics remain owned by the runtime or by separate protocol packages.

## Known Limitations and Deferred Work

- `v1alpha1` does not define a cross-runtime tool invocation operation.
- JSON Schema is transported as inert data; consumers choose their validator and supported dialect.
- UI render hints and result attachments are not part of this resource family.
