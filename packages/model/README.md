# @dsh-std/model

English | [中文](README.zh.md)

Named model-provider resources and the shared catalog used to discover them.

## ModelProvider resources

A `ModelProvider` resource represents one installed model integration such as OpenAI Codex, Anthropic, or DeepSeek. Its static specification contains display titles and optional structured `CommandReference` values for authentication, sign-out, and configuration. A reference names a `Command` resource and command path; it is not an executable callback or an encoded command line.

Runtime-owned status distinguishes `ready`, `authentication-required`, and `unavailable`. It also publishes provider-local model ids, names, descriptions, explicit selectability, and an optional reason. An absent extension means no active facet published that provider; an active provider may independently require authentication.

`ModelProvider` is not a capability provider in the connection registry. A facet may publish a `ModelProviderHandler` for the resource. The handler performs endpoint-local inference through standard messages, tool schemas, attachment reads, and stream chunks; a product adapter maps those values to its own model registry.

## ModelCatalog capability

`ModelCatalog` is a capability protocol implemented once by a runtime adapter. Its `list` and `get` operations expose every active `ModelProvider` extension together with component, facet, participant, and runtime state. Multiple providers coexist as distinct named extensions while connection negotiation sees one unambiguous catalog implementation.

`modelCatalog()` provides a typed connection client, and `modelCatalogImplementation()` creates the adapter-side dispatcher and validation. Neither a provider facet nor a presentation client defines its own connection method.

A model component declares its provider extension and publishes its handler. It does not import a product adapter or define connection-specific methods. When the agent and model integration share an endpoint, the product adapter calls that handler.

## Known Limitations and Deferred Work

- `v1alpha1` does not standardize remote inference, model selection mutation, credentials, billing, or quotas.
- Catalog operations expose current snapshots; change subscriptions are not defined.
- Provider management workflows are referenced through `Command` resources rather than duplicated in this RFC.
