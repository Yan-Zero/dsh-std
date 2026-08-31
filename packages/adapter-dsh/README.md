# @dsh-std/adapter-dsh

English | [中文](README.zh.md)

The DeepSeek Harness product adapter described by the [adapter proposal](../../docs/proposals/adapter-dsh.zh.md). Cordis, Typert, Agent, and DSH command-registry types stop at this package.

`DshStandardAdapter` owns protocol and manifest definition catalogs, activation drivers, a lifecycle coordinator, and a connection endpoint. It is not a global plugin registry.

This package is itself a DSH profile bundle and is activated by its `cordis.patch.yml`. It scans the active profile's ordinary dependencies for Community v0.15 `dsh-plugin.json`, negotiates `requires.contracts`, and loads `facets.host.entry`. Standard plugins neither declare `dsh.bundle` nor import this adapter.

In a browser-capable profile, the adapter's own DSH browser half reads standard `browser.ui.dsh/v1alpha1 LocalModule` declarations, serves their package-local artifacts, and activates them through the DSH `0.1.2-alpha.2` API Gateway, Session Controller, client module system, and Cordis lifecycle. Components do not need a root Loader entry or `dsh.client` metadata. TUI and headless profiles do not load these modules; only browser transport and UI peers are optional, while the Host adapter requires the `sessionController` service.

The browser half implements the optional `@dsh-std/ui-browser` `SettingsSection` and `ToolCallView` surfaces. It waits for the corresponding native slots with `slots.inject()`, negotiates a facet-scoped `ui.dsh/v1alpha1 ContributionHost`, and retracts every slot registration when the standard browser-realm facet unloads. Components import the surface protocol package, never this adapter; raw DSH slot names remain inside the adapter. The DSH Plugins page receives a separate standard-component inventory tab, so standard lifecycle state is visible without manufacturing Cordis Loader rows.

Commands remain executable through the standard `CommandRuntime`. A product UI publishes commands into its native command registry only after registering a provider for an exact placement coordinate. Web, Desktop, TUI, and other shells are therefore capabilities, not hard-coded profile classes.

```sh
dsh plugin --profile web add @dsh-std/adapter-dsh
dsh plugin --profile web add <standard-component>
```

Other hosts may call `mount()` directly. Module resolution and product-service projection remain responsibilities of the host adapter and do not enter the portable component.

The entrypoint stages facts with `context.protocols.implement()` and `context.extensions.publish()`. They become live publications and connection declarations only after activation, static-bound validation, and protocol negotiation succeed. Failure or unmount revokes everything by activation-instance owner.

The current mappings implement `CommandRuntime`, `ModelCatalog`, `SessionCatalog` list/get/create/rename, `SessionHistory` read/follow, local `Tool` / `ToolOverride` activation, and browser-local UI contributions. Session descriptors and history use the Session Controller's cold-safe list/inspect/follow seams. The adapter does not claim delete, watch, or idempotent fork operations for which DSH does not expose equivalent semantics. Product-native DSH events are portable but ignorable; component-declared `SessionEvent` resources retain their replay classification.

Tool functions never cross the connection endpoint: the adapter registers them into DSH's native registry and supplies DSH model, attachment, filesystem observation, write-intent, sandbox, and nested-context semantics for each accepted call. Catalog entries come only from extensions published by active facets and retain component, facet, and participant provenance. The adapter does not serialize Presentation work into command results; a Connection Host must supply invocation-scoped typed clients for active Presentation agreements.
