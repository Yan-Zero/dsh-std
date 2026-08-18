# @dsh-std/tool

English | [中文](README.zh.md)

Runtime discovery contract and local same-process execution seam for model-facing tools.

## Contract

A `Tool` resource declares a title, localized titles, and a catalog description. Runtime-owned status reports whether the tool is `available` or `unavailable`. An available tool may project its resolved model description and inert JSON Schema parameters; an unavailable tool may explain why it cannot be used.

The static extension records its component and facet owner. Status answers what the active runtime can expose for the current composition. This separation supports progressive disclosure without claiming that every installed tool is active or sending executable validators across endpoints.

An activated facet may publish a `ToolHandler` beside its `Tool` resource. The handler resolves a portable executable definition which a same-process adapter can map into its native tool registry. Execution receives host-owned facilities for model capabilities, image validation and attachments, observed workspace reads, policy-checked workspace writes, nested content deferral, and (for an override) delegation to the original tool. These facilities preserve the host's policy and durable-log semantics instead of reimplementing them in a component.

This is deliberately not a cross-runtime invocation protocol: functions and byte buffers remain local to one process. Streaming, approval, tool-call transport, and transcript ownership remain runtime concerns.

## Known Limitations and Deferred Work

- `v1alpha1` does not define a cross-runtime tool invocation operation; executable handlers are local activation values.
- JSON Schema is transported as inert data; consumers choose their validator and supported dialect.
- UI render hints are not part of this resource family. Local results can reference host-owned image attachments without transporting their bytes in JSON.
