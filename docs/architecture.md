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
- agent defines live Agent control and configuration;
- session defines persistent catalogs, history, and event vocabulary;
- workspace defines registered work locations and Session membership;
- content defines shared content references and transfer;
- command defines command catalogs and execution semantics;
- tool defines tool discovery and disclosure;
- model defines model-provider catalogs;
- presentation defines invocation-scoped user-facing operations.

Each domain protocol declares its own versions and semantics. Connection carries domain protocol interactions without interpreting domain data.

A protocol package may contain types, schemas, codecs, negotiation algorithms, state machines, and conformance tests. Its proposal identifies the normative parts.

## Product implementations

```text
                        @dsh-std/core
                 declarations and negotiation
                              |
           +------------------+------------------+
           |                  |                  |
       connection          command / tool      presentation
       specification       specification       specification
           |                  |                  |
           +------------------+------------------+
                              |
                 host / tui / web / gui / plugin
                    implement selected protocols
```

A product selects protocols and binds their operations to runtime capabilities. Filesystems, networking, credentials, processes, user interfaces, and policy belong to the product implementation.

## Declarations and negotiation

Negotiation keeps three facts separate:

1. an evaluator **understands** a protocol and can validate it;
2. a participant **supports** a protocol with a live implementation;
3. a set of participants has formed an **agreement** for that protocol.

Evaluator knowledge, participant support, and agreement are declared and calculated separately. Authorization is determined by the relevant protocol or product policy.

Core dispatches to protocol definitions. Each protocol decides how many parties participate, whether multiple implementations are allowed, how versions and features are selected, and whether the result contains bindings or another composition model.

## Connection

Connection is an independent protocol built on core. It defines endpoint identities, offers, plans, bindings, invocation lifetimes, attachment transfer, and connection state.

A wire profile defines encoding, framing, authentication binding, flow control, and closure. A carrier profile defines Connection's requirements on an underlying channel.

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

A manifest declares components and facets. Activating a facet creates an activation instance, which may publish a participant declaration within a negotiation scope.

A facet's `activation` is an open, versioned object. An activation definition specifies its parameters, and an activation driver performs lifecycle operations. Composition selects facets according to available definitions, drivers, and protocol requirements.

## Package boundaries

- [`@dsh-std/core`](../packages/core/README.md) defines the meta-protocol for pluggable protocol declarations and negotiation;
- [`command`](../packages/command/README.md), [`model`](../packages/model/README.md), [`tool`](../packages/tool/README.md), [`session`](../packages/session/README.md), and [`presentation`](../packages/presentation/README.md) define independent domain protocols;
- [`@dsh-std/connection`](../packages/connection/README.md) defines endpoint connection semantics and reusable reference components;
- [`@dsh-std/adapter-dsh`](../packages/adapter-dsh/README.md) maps standard protocols to DeepSeek Harness.

Only dependencies explicitly required by a protocol belong between standard packages. Adding a domain protocol does not require a core release or adoption by existing implementations.

## Compatibility and evolution

Every protocol owns its `apiVersion`. Core identifies the protocol and dispatches its negotiation; the protocol defines compatibility between versions.

An incompatible domain change uses a new protocol version. An implementation may advertise multiple versions during migration. Whether multiple versions can be active in one connection or process is also protocol-defined.

Implementations should produce machine-readable reports that distinguish unknown protocols, incompatible versions, missing optional requirements, and protocol-specific failures.
