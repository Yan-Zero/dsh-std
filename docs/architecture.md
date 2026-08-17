# DSH Standard Architecture

English | [中文](architecture.zh.md)

This document describes how DSH Standard specifications are layered and where product implementations begin.

## DSH Standard

DSH Standard is a collection of independently implementable protocols, not a framework that must be adopted as a whole. A Host, TUI, Web application, GUI, plugin, or remote agent may implement only the protocols it needs.

Interoperability follows declared protocols and negotiated results. It does not follow product names or the installation of a particular npm package.

## The core meta-protocol

`@dsh-std/core` defines protocol identities, participant declarations, and the negotiation envelope. A participant declares the protocols it requires and the protocols it actually supports in the current scope.

Core locates the definition for each `apiVersion` and `kind`. The definition validates protocol-specific parameters and calculates that protocol's agreement. Core aggregates the results without interpreting their domain meaning.

Core does not prescribe resources, capabilities, providers, execution planes, endpoints, or UI models. A protocol defines those concepts when it needs them.

## Independent protocols

Protocols above core evolve independently. For example:

- connection defines endpoint offers, agreements, and connection-scoped attachments;
- command defines command catalogs and execution semantics;
- tool defines tool discovery and disclosure;
- model defines model-provider catalogs;
- presentation defines invocation-scoped user-facing operations.

Implementing connection does not imply implementing command or tool. Connection may carry their messages but does not interpret their business semantics.

A protocol package may include reference code. A simple protocol may ship only types and schemas; connection may also ship negotiation, codecs, state machines, and conformance fixtures. Reference code does not replace the product's listeners, processes, UI, policy, or business handlers.

## Product implementations

```text
                        @dsh-std/core
                 declarations and negotiation
                              |
           +------------------+------------------+
           |                  |                  |
       connection        command / tool      presentation
       specification       specifications      specification
           |                  |                  |
           +------------------+------------------+
                              |
                 host / tui / web / gui / plugin
                    implement selected protocols
```

A Host may implement a connection acceptor and agent-control protocols. A TUI or Web application may implement a connector and presentation protocols. Remote SSH may provide a connection carrier. A DSH adapter may map command or tool protocols to existing Harness services. Another product can implement the same protocols without importing the DSH adapter.

Protocol helpers implement deterministic behavior already specified by a protocol. Filesystems, ports, credentials, processes, widgets, Cordis services, and product policy belong to implementations.

## Declarations and negotiation

Negotiation keeps three facts separate:

1. an evaluator **understands** a protocol and can validate it;
2. a participant **supports** a protocol with a live implementation;
3. a set of participants has formed an **agreement** for that protocol.

Installing a protocol definition does not create a live implementation. Static package metadata does not prove current availability. An agreement does not bypass product authorization.

Core dispatches to protocol definitions. Each protocol decides how many parties participate, whether multiple implementations are allowed, how versions and features are selected, and whether the result contains bindings or another composition model.

## Connection

Connection is an independent protocol that uses core; it is not a built-in transport layer of core.

It defines endpoint offers, accepted plans, attachment lifetime, and connection state. Host, TUI, Web, and GUI applications can implement it over in-process calls, IPC, stdio, HTTP, WebSocket, SSH forwarding, QUIC, or another carrier.

Domain messages remain owned by their protocols. Connection negotiates and carries them without executing commands, tools, sessions, agents, or UI operations itself.

## Components and plugins

Plugin packages, entrypoints, component dependencies, lifecycle, permissions, and contributions are not part of the core meta-protocol. They are specified by the manifest, composition, lifecycle, events, and permission proposals.

Those specifications reuse core requirement and support shapes so a component can state its static bounds. Programs that do not use the component model can submit live core declarations directly.

The component model separates four identities:

```text
Component                    installation, version, and provenance unit
└── Facet                    static selection and activation unit
    └── Activation instance  lifecycle, permission, and local ownership unit
        └── Participant      live entity in a core negotiation scope
```

In the first version of the component model, an activation instance corresponds to one local participant. A facet that only supplies extension handlers need not submit an empty declaration to core. A manifest stops at the facet: it neither creates a live participant nor turns a potential support into a live fact.

A facet's `activation` is an open, versioned object. A product adapter may define Cordis, browser, or other activation kinds and register their drivers with its loader. Core does not maintain `client/server`, `local/remote`, or profile enums. Composition selects only facets for which the current loader has an explicit compatible driver and whose static requirements can be satisfied.

## Package boundaries

- [`@dsh-std/core`](../packages/core/README.md) defines the meta-protocol for pluggable protocol declarations and negotiation;
- [`command`](../packages/command/README.md), [`model`](../packages/model/README.md), [`tool`](../packages/tool/README.md), and [`presentation`](../packages/presentation/README.md) define independent domain protocols;
- [`@dsh-std/connection`](../packages/connection/README.md) defines endpoint connection semantics and reusable reference components;
- [`@dsh-std/adapter-dsh`](../packages/adapter-dsh/README.md) implements and maps selected protocols for DeepSeek Harness.

Only dependencies explicitly required by a protocol belong between standard packages. Adding a domain protocol does not require a core release or adoption by existing implementations.

## Compatibility and evolution

Every protocol owns its `apiVersion`. Core identifies the protocol and dispatches its negotiation; the protocol defines compatibility between versions.

An incompatible domain change uses a new protocol version. An implementation may advertise multiple versions during migration. Whether multiple versions can be active in one connection or process is also protocol-defined.

Implementations should produce machine-readable reports that distinguish unknown protocols, incompatible versions, missing optional requirements, and protocol-specific failures.
