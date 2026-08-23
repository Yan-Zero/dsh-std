# DSH Standard

English | [中文](README.zh.md)

In plain terms, DSH Standard is a set of **universal interoperability protocols**. Its goal is simple: let DSH plugins, background runtimes, and various user interfaces (TUI terminals, Web UIs, desktop apps, headless daemons) decouple cleanly and work together smoothly.

`@dsh-std/core` is a "meta-protocol" (the **protocol about protocols**). Domain-specific protocols—like Command, Tool, Model, and Presentation—sit on top of this meta-protocol substrate for discovery and negotiation, each versioned independently. Different hosts and applications only implement the parts they actually need.

Reference packages provide types, validators, and pure-function negotiators. Conforming implementations are not required to depend on these npm packages, nor do they need to run inside DeepSeek Harness.

## What is a "Meta-protocol" (The Protocol About Protocols)?

Most protocols you deal with handle **specific domain tasks**:
- A Command protocol handles how commands are registered and executed;
- A Model protocol governs how LLM providers are plugged in;
- A Presentation protocol handles UI dialogs, questions, and approvals.

In contrast, `@dsh-std/core` **knows zero domain business fields** (it doesn't even know what a command or a model is). It is purely the **"protocol about protocols"**:

- It defines universal primitives: how protocols are identified (`apiVersion` + `kind`), how participants declare what they need (`requires`) and what they provide (`supports`), and how to run pure-function negotiations to output a structured compatibility report.
- **An analogy**: It works like the USB interface specification. The core only cares about physical pinouts, slot dimensions, and handshake negotiation. Whether you plug in a mouse, keyboard, thumb drive, or webcam, the core never needs to know or change.

**Why is this powerful?**  
Monolithic frameworks hardcode every capability (commands, storage, events) into a central SDK; whenever a new domain arises, the entire framework requires a release or a breaking change. Under a meta-protocol architecture, **the protocols themselves are pluggable plugins**: public standards, community extensions, and private protocols alike register as standalone protocol definitions. The core never changes, letting the ecosystem evolve boundlessly on its own.

## Why Decouple via Adapters?

The upstream DSH core and downstream ecosystem plugins have inherently different engineering priorities:

- **Upstream DSH focuses on rapid innovation**: Its mission is to build the fastest, most capable Agent execution engine, requiring frequent iteration over model scheduling, context engineering, and internal architecture. The core should not have its hands tied by external UI variations or third-party interop standards.
- **Downstream plugins need stable contracts**: Plugin authors want to focus on feature logic without worrying that their code will break with every upstream update.

**The Adapter serves as a single-point shock absorber**:
It isolates the upstream runtime from the universal protocol layer. DSH is free to refactor aggressively; all potential breaking changes are absorbed within a single adapter layer ([`@dsh-std/adapter-dsh`](packages/adapter-dsh/README.md)), shielding the broader ecosystem from code churn. Similarly, standalone TUIs, Web frontends, and remote runners can plug in via their own adapters on equal footing.

## What else is great about this (Beyond stable dependencies)?

Shielding plugins from upstream breaking changes is just the baseline. In day-to-day development, this architecture brings several concrete superpowers:

- **True Write-Once, Run-Anywhere (No multi-platform rewrites)**: Authors write their plugins against standard protocol contracts. Once written, the exact same plugin code runs without changes in TUI terminals, Web browsers, Remote SSH services, or headless daemon containers.
- **On-Demand Activation & Zero Leaks (Facet model)**: A single plugin package can contain both frontend UI and backend logic. A host only activates the facets it needs (e.g., a headless server never loads frontend UI code). When a plugin is disabled or uninstalled, all listeners, timers, and resources are automatically garbage-collected by the scope.
- **Know Before Installing (No crash roulette)**: With static manifests (`dsh-plugin.json`), marketplaces, hosts, and CI tools calculate compatibility in milliseconds **without running a single line of plugin code**. No more installing a plugin only to find out it crashes at runtime.
- **Blazing-fast Headless Unit Tests**: The protocol core consists entirely of pure data structures and pure-function negotiators. Testing plugins or hosts takes tens of milliseconds in lightweight Node.js/CI—no need to spin up a full DSH instance or heavy browser.
- **Decentralized Ecosystem Growth**: Want to create a novel Agent capability (like special multimodal streaming or bespoke tool hooks)? Define your own protocol and run with it—no need to wait for approval or central releases.

## Vision: Layered, Optional, Non-coercive

```text
Meta-protocol (core)   only defines how protocols are declared and negotiated; no domain concepts, no fixed roles
        |
Domain protocols       connection / command / tool / session / presentation / agent ...
        |              independently versioned, implementable and replaceable; future protocols may supersede them
        |
Profiles               admission and interoperability specifications for concrete product shapes,
                       carried by ecosystem projects (e.g. dsh-ecosystem-spec provides the TUI Profile)
```

- **Adoption is voluntary**: No project is forced to adopt this standard; but once claiming conformance to a protocol version, it must pass the corresponding conformance suite.
- **Radical Agent exploration welcomed**: Headless clusters, long-running daemon agents, and distributed collaborative systems can all grow naturally on top of the meta-protocol.
- Projects wanting a familiar "Host + Plugin Manifest" experience can follow the relevant Profile; those with other architectures remain completely unrestricted.

## Start here

- Read the [architecture](docs/architecture.md) for the boundary between the meta-protocol, independent protocols, and product implementations.
- The current design work is indexed in the [Chinese proposal index](docs/proposals/README.zh.md).
- See the [Endpoint Connection proposal](docs/proposals/endpoint-connection.zh.md) for connection negotiation and attachments.
- Use the [package index](packages/README.md) to select the smallest implemented package surface.
- Adapter code for DSH lives in [`@dsh-std/adapter-dsh`](packages/adapter-dsh/README.md).

## Status

The code and proposals are early drafts.

Each package records changes in its own `CHANGELOG.md`. Public contract modifications must update the corresponding changelog.

## Development

Node.js `^22.19 || >=24` and pnpm are required.

```sh
pnpm install
pnpm check
```

## License

[MIT](LICENSE)
