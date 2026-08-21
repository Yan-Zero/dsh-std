# DSH Standard

English | [中文](README.zh.md)

DSH Standard is a collection of independently versioned protocols that implementations may adopt as needed. It enables DSH plugins, runtimes, and user interfaces to interoperate without requiring one framework or product.

`@dsh-std/core` is the meta-protocol used to declare and negotiate other protocols. Connection, command, tool, and presentation are discovered through core but define their own semantics. Hosts, TUIs, Web applications, GUIs, and other programs may implement only the relevant subset.

Protocol packages may ship types, validators, negotiation algorithms, state machines, or conformance fixtures as reference implementations. A conforming implementation does not have to use the TypeScript packages or DeepSeek Harness.

## Vision: layered, optional, non-coercive

DSH Standard is organized in three layers:

```text
Meta-protocol (core)   only defines how protocols are declared and negotiated; no domain concepts, no fixed roles
        |
Domain protocols       connection / command / tool / session / presentation / agent ...
        |              independently versioned, implementable and replaceable; future protocols may supersede them
        |
Profiles               admission and interoperability specifications for concrete product shapes,
                       carried by ecosystem projects (e.g. dsh-ecosystem-spec provides the TUI Profile)
```

- **This repository enforces nothing.** Every protocol is optional and replaceable; the packages are reference implementations. An implementation may ignore every DSH Standard protocol and implement its own negotiation and selection logic.
- **Agent self-evolution is encouraged.** The standard does not define what the ecosystem must look like; implementors may freely explore new protocols, negotiation models, and runtime shapes on top of the meta-protocol.
- **Radical agent architectures are welcome.** Headless facilities, long-running agents, remote runtimes, event-driven systems, or agent architectures that do not exist yet can all appear on the same meta-protocol; when they do, new protocols and profiles supersede old ones without rewriting the standard.
- Projects that want the familiar "Host + Plugin + Manifest" experience can follow the relevant Profile (see dsh-ecosystem-spec); implementations that do not adopt these concepts are not restricted in any way.

## Start here

- Read the [architecture](docs/architecture.md) for the boundary between the meta-protocol, independent protocols, and product implementations.
- The current design work is indexed in the [Chinese proposal index](docs/proposals/README.zh.md).
- See the [Endpoint Connection proposal](docs/proposals/endpoint-connection.zh.md) for connection negotiation and attachments.
- Use the [package index](packages/README.md) to select the smallest implemented package surface.
- Product integration belongs in adapters such as [`@dsh-std/adapter-dsh`](packages/adapter-dsh/README.md), not in portable protocol packages.

## Status

The code and proposals are early drafts. The target boundaries in the proposals may be ahead of the current TypeScript prototypes; existing exports are not stable until that migration is complete.

Each package records protocol, type, validator, and adapter changes in its own `CHANGELOG.md`. A public contract change must update that package's changelog, which is also included in the published artifact.

## Development

Node.js `^22.19 || >=24` and pnpm are required.

```sh
pnpm install
pnpm check
```

## License

[MIT](LICENSE)
