# DSH Standard

English | [中文](README.zh.md)

DSH Standard is a collection of independently versioned protocols that implementations may adopt as needed. It enables DSH plugins, runtimes, and user interfaces to interoperate without requiring one framework or product.

`@dsh-std/core` is the meta-protocol used to declare and negotiate other protocols. Connection, command, tool, and presentation are discovered through core but define their own semantics. Hosts, TUIs, Web applications, GUIs, and other programs may implement only the relevant subset.

Protocol packages may ship types, validators, negotiation algorithms, state machines, or conformance fixtures as reference implementations. A conforming implementation does not have to use the TypeScript packages or DeepSeek Harness.

## Start here

- Read the [architecture](docs/architecture.md) for the boundary between the meta-protocol, independent protocols, and product implementations.
- The current design work is indexed in the [Chinese proposal index](docs/proposals/README.zh.md).
- See the [Endpoint Connection proposal](docs/proposals/endpoint-connection.zh.md) for connection negotiation and attachments.
- Use the [package index](packages/README.md) to select the smallest implemented package surface.
- Product integration belongs in adapters such as [`@dsh-std/adapter-dsh`](packages/adapter-dsh/README.md), not in portable protocol packages.

## Status

The code and proposals are early drafts. The target boundaries in the proposals may be ahead of the current TypeScript prototypes; existing exports are not stable until that migration is complete.

## Development

Node.js `^22.19 || >=24` and pnpm are required.

```sh
pnpm install
pnpm check
```
