# @dsh-std/adapter-dsh

English | [中文](README.zh.md)

The DeepSeek Harness product adapter described by the [adapter proposal](../../docs/proposals/adapter-dsh.zh.md). Cordis, Typert, Agent, and DSH command-registry types stop at this package.

`DshStandardAdapter` owns protocol and manifest definition catalogs, activation drivers, a lifecycle coordinator, and a connection endpoint. It is not a global plugin registry.

After discovering and validating `manifest.yaml`, a DSH loader passes only a composition-selected facet to `mount()`. The loader resolves its `adapter.dsh/v1alpha1 CordisEntrypoint` module; the adapter creates the scoped `ActivationContext`.

The entrypoint stages facts with `context.protocols.implement()` and `context.extensions.publish()`. They become live publications and connection declarations only after activation, static-bound validation, and protocol negotiation succeed. Failure or unmount revokes everything by activation-instance owner.

The current mappings implement `CommandRuntime` and `ModelCatalog`. Catalog entries come only from extensions published by active facets and retain component, facet, and participant provenance. Presentation operations remain invocation-scoped and require both a declared requirement and current client support.
