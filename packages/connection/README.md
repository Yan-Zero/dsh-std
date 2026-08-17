# @dsh-std/connection

English | [中文](README.zh.md)

The proposed design is documented in [Endpoint Connection](../../docs/proposals/endpoint-connection.zh.md). It separates the application-facing `ConnectionService` from the Connection Host provider SPI. The remainder of this page describes the current reference implementation, which does not yet complete that split.

Host-provided communication service, two-endpoint capability negotiation, and implementation-neutral invocation for the DSH Standard.

## Endpoint offers

An endpoint offer contains an endpoint identity, a revision, and the live participant declarations admitted by endpoint policy. It carries no component manifests, installation inventory, or plugin registry.

`resolveConnection()` passes both sets of declarations to a caller-owned `ProtocolCatalog`. Each protocol definition owns its negotiation and may place invocation bindings in its agreement; connection does not impose consumer/provider semantics on every protocol. `defineCapabilityProtocol()` is an explicit helper for domain protocols that do use RPC-shaped bindings.

Each invocation binding is participant-scoped and plan-revision-scoped. A client for one participant cannot discover or invoke bindings granted to another participant.

## Current reference API

`StandardConnection` exposes endpoint identities, the active plan, consumer-scoped clients, plan-change observation, and close. `CapabilityClient.invoke()` returns an invocation id, a result promise, an asynchronous progress stream, and cancellation. Domain protocol packages own operation names and input, output, and progress values.

`ConnectionBroker` selects one registered `ConnectionConnector` for an implementation-neutral target URI. Zero matches and multiple matches are both explicit errors. The broker does not expose the selected connector type through `StandardConnection`.

These types are an early reference implementation. They do not require a TUI, Web UI, GUI, or business plugin to register and operate its own connector. The protocol direction places the broker, connector/provider registry, carrier, and wire behind a Connection Host's `ConnectionService`. A consumer submits a target and uses scoped typed clients for the negotiated protocols.

A Connection Host may install or discover a remote service, own authentication, ports, forwarding and reconnection, and produce the `StandardConnection`. An SSH target facet contributes resolution and bootstrap integration while system OpenSSH or another provider may supply the physical SSH implementation. Applications do not observe the selected provider, ports, credentials, or wire.

## Lifecycle

Renegotiation creates a complete new plan revision and publishes it atomically. An invocation admitted under the old revision retains its binding until settlement; later invocations use the new revision. Closing a connection cancels active work and rejects new work with `connection-closed`.

Transport implementations must preserve invocation isolation, progress order, cancellation, and the error classification exposed by `ConnectionInvocationError`. They are also responsible for authenticating the peer and preventing one connection from reusing another connection's grants.

## Reference implementation

The `@dsh-std/connection/memory` export provides a process-local implementation for tests, adapters, and conformance experiments. It demonstrates symmetric calls, progress, cancellation, isolation, and renegotiation. It is not a required carrier or a wire-format specification.

## Known Limitations and Deferred Work

- The consumer-facing `ConnectionService` and Host provider SPI are not implemented in the current code yet.
- The package does not yet standardize discovery, authentication, encryption, reconnect policy, framing, or serialization.
- A connection has exactly two endpoints in `v1alpha1`; multi-party routing is composed from separate connections.
- The capability helper requires one peer provider by default. Protocols that allow multiple providers must opt into and define that behavior explicitly.
