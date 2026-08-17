# Packages

English | [中文](README.zh.md)

Each package owns one independently versioned part of the proposal. Consumers should depend on the narrowest package that defines the behavior they use.

| Package | Responsibility | Depends on a product |
|---|---|---|
| [`@dsh-std/core`](core/README.md) | Protocol declarations, definition registration, and meta-negotiation | No |
| [`@dsh-std/manifest`](manifest/README.md) | YAML 1.2 Component/Facet manifests and static validation | No |
| [`@dsh-std/composition`](composition/README.md) | Facet selection, static preflight, and composition plans | No |
| [`@dsh-std/lifecycle`](lifecycle/README.md) | Activation instances, cleanup, and the publication barrier | No |
| [`@dsh-std/sdk`](sdk/README.md) | TypeScript facet and typed-protocol helpers | No |
| [`@dsh-std/command`](command/README.md) | Declarative human-command trees | No |
| [`@dsh-std/model`](model/README.md) | ModelProvider resources and the shared ModelCatalog | No |
| [`@dsh-std/tool`](tool/README.md) | Tool discovery and live availability | No |
| [`@dsh-std/presentation`](presentation/README.md) | Invocation-scoped user-facing operations | No |
| [`@dsh-std/connection`](connection/README.md) | Endpoint negotiation and implementation-neutral invocation | No |
| [`@dsh-std/adapter-dsh`](adapter-dsh/README.md) | DeepSeek Harness and Cordis integration | Yes |
| [`dsh-std`](namespace-guard/README.md) | Unscoped npm name reservation | No runtime API |

Protocol packages may depend on `@dsh-std/core` and may explicitly adopt the capability helper in `@dsh-std/connection` when they use an RPC shape. They must not depend on product adapters. Adapters may depend on the protocol packages they map into a product.
