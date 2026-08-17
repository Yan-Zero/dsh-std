# @dsh-std/connection

English | [中文](README.zh.md)

Two-endpoint capability negotiation and implementation-neutral invocation for the DSH Standard.

## Endpoint offers

An endpoint offer contains an endpoint identity, a revision, and the live participant declarations admitted by endpoint policy. It carries no component manifests, installation inventory, or plugin registry.

`resolveConnection()` passes both sets of declarations to a caller-owned `ProtocolCatalog`. Each protocol definition owns its negotiation and may place invocation bindings in its agreement; connection does not impose consumer/provider semantics on every protocol. `defineCapabilityProtocol()` is an explicit helper for domain protocols that do use RPC-shaped bindings.

Each invocation binding is participant-scoped and plan-revision-scoped. A client for one participant cannot discover or invoke bindings granted to another participant.

## Public connection API

`StandardConnection` exposes endpoint identities, the active plan, consumer-scoped clients, plan-change observation, and close. `CapabilityClient.invoke()` returns an invocation id, a result promise, an asynchronous progress stream, and cancellation. Domain protocol packages own operation names and input, output, and progress values.

`ConnectionBroker` selects one registered `ConnectionConnector` for an implementation-neutral target URI. Zero matches and multiple matches are both explicit errors. The broker does not expose the selected connector type through `StandardConnection`.

This makes a remote Host one possible implementation rather than an architectural dependency. A Host connector may install or discover a remote service, authenticate, forward a port, reconnect, and implement `StandardConnection`. Another connector may use IPC or direct in-process calls. Protocol consumers communicate with `CapabilityClient` in either case and do not know that a Host exists.

## Lifecycle

Renegotiation creates a complete new plan revision and publishes it atomically. An invocation admitted under the old revision retains its binding until settlement; later invocations use the new revision. Closing a connection cancels active work and rejects new work with `connection-closed`.

Transport implementations must preserve invocation isolation, progress order, cancellation, and the error classification exposed by `ConnectionInvocationError`. They are also responsible for authenticating the peer and preventing one connection from reusing another connection's grants.

## Reference implementation

The `@dsh-std/connection/memory` export provides a process-local implementation for tests, adapters, and conformance experiments. It demonstrates symmetric calls, progress, cancellation, isolation, and renegotiation. It is not a required carrier or a wire-format specification.

## Known Limitations and Deferred Work

- The package does not standardize discovery, authentication, encryption, reconnect policy, framing, or serialization.
- A connection has exactly two endpoints in `v1alpha1`; multi-party routing is composed from separate connections.
- The capability helper requires one peer provider by default. Protocols that allow multiple providers must opt into and define that behavior explicitly.
