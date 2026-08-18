# @dsh-std/adapter-dsh

English | [中文](README.zh.md)

The DeepSeek Harness product adapter described by the [adapter proposal](../../docs/proposals/adapter-dsh.zh.md). Cordis, Typert, Agent, and DSH command-registry types stop at this package.

`DshStandardAdapter` owns protocol and manifest definition catalogs, activation drivers, a lifecycle coordinator, and a connection endpoint. It is not a global plugin registry.

This package is itself a DSH profile bundle and is activated by its `cordis.patch.yml`. It scans the active profile's ordinary dependencies for Community v0.15 `dsh-plugin.json`, negotiates `requires.contracts`, and loads `facets.host.entry`. Standard plugins neither declare `dsh.bundle` nor import this adapter.

In a Web profile, the same package also contributes an ordinary DSH browser half through `dsh.client`. The Host discovery path seats a component's browser half only when the native `clientModules` service is live and that component declares `dsh.client.platform: "web"`. TUI and headless profiles return before reading or loading browser metadata; all Web peers are optional.

The browser half implements the optional `@dsh-std/ui-browser` `SettingsSection` and `ToolCallView` surfaces. It waits for the corresponding native slots with `slots.inject()`, negotiates a facet-scoped `ui.dsh/v1alpha1 ContributionHost`, and retracts every slot registration when the standard browser-realm facet unloads. Components import the surface protocol package, never this adapter; raw DSH slot names remain inside the adapter.

Commands remain executable through the standard `CommandRuntime`. A product UI publishes commands into its native command registry only after registering a provider for an exact placement coordinate. Web, Desktop, TUI, and other shells are therefore capabilities, not hard-coded profile classes.

```sh
dsh plugin --profile web add @dsh-std/adapter-dsh
dsh plugin --profile web add <standard-component>
```

Other hosts may call `mount()` directly. Module resolution and product-service projection remain responsibilities of the host adapter and do not enter the portable component.

The entrypoint stages facts with `context.protocols.implement()` and `context.extensions.publish()`. They become live publications and connection declarations only after activation, static-bound validation, and protocol negotiation succeed. Failure or unmount revokes everything by activation-instance owner.

The current mappings implement `CommandRuntime`, `ModelCatalog`, local `Tool` / `ToolOverride` activation, and browser-local UI contributions. Tool functions never cross the connection endpoint: the adapter registers them into DSH's native registry and supplies DSH model, attachment, filesystem observation, write-intent, sandbox, and nested-context semantics for each accepted call. Catalog entries come only from extensions published by active facets and retain component, facet, and participant provenance. The adapter does not serialize Presentation work into command results; a Connection Host must supply invocation-scoped typed clients for active Presentation agreements.
