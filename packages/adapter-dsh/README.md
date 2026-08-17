# @dsh-std/adapter-dsh

English | [中文](README.zh.md)

The DeepSeek Harness product adapter described by the [adapter proposal](../../docs/proposals/adapter-dsh.zh.md). Cordis, Typert, Agent, and DSH command-registry types stop at this package.

`DshStandardAdapter` owns protocol and manifest definition catalogs, activation drivers, a lifecycle coordinator, and a connection endpoint. It is not a global plugin registry.

This package is itself a DSH profile bundle and is activated by its `cordis.patch.yml`. It scans the active profile's ordinary dependencies for Community v0.15 `dsh-plugin.json`, negotiates `requires.contracts`, and loads `facets.host.entry`. Standard plugins neither declare `dsh.bundle` nor import this adapter.

```sh
dsh plugin --profile web add @dsh-std/adapter-dsh
dsh plugin --profile web add <standard-component>
```

Other hosts may call `mount()` directly. Module resolution and product-service projection remain responsibilities of the host adapter and do not enter the portable component.

The entrypoint stages facts with `context.protocols.implement()` and `context.extensions.publish()`. They become live publications and connection declarations only after activation, static-bound validation, and protocol negotiation succeed. Failure or unmount revokes everything by activation-instance owner.

The current mappings implement `CommandRuntime` and `ModelCatalog`. Catalog entries come only from extensions published by active facets and retain component, facet, and participant provenance. The adapter does not serialize Presentation work into command results; a Connection Host must supply invocation-scoped typed clients for active Presentation agreements.
