# Changelog

Changes to `@dsh-std/session` are recorded here.

## 0.1.1-rc.2

- Added separately negotiable `SessionCatalog` and `SessionHistory` capability surfaces with provider-scoped references, operation negotiation, typed clients, validated implementations, pagination, follow streams, and explicit fork semantics.
- Defined explicit `ready` progress frames for Catalog watch and History follow so revision/cursor handoff is observable before streamed events.
- Added stable Session protocol error codes for lifecycle, cursor, concurrency, authorization, flow-control, and persistence failures.
- Added optional `schemaDialect` metadata without rejecting legacy `v1alpha1` event declarations that only contain `payloadSchema`.
- Kept durable Session observation on `SessionHistory.read` / `follow`, without introducing a second generic event stream or unrestricted event append operation.
- Removed Workspace placement from Session creation and fork inputs so `WorkspaceSessions` remains the sole owner of membership and cross-protocol partial success stays explicit.

## 0.1.1-rc.1

- Aligned the package with the workspace `0.1.1` prerelease line without changing the existing Session protocol semantics.

## 0.1.0-rc1

- Defined namespaced session event resources and their manifest extension definition.
- Kept product persistence and presentation state outside the event vocabulary.
