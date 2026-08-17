# @dsh-std/command

English | [中文](README.zh.md)

Named human-command resources and their shared callable Runtime dispatcher.

## Contract

A `Command` resource describes one root command and its nested subcommands. Nodes provide a title, localized titles, description, aliases, positional arguments, options, and child nodes. Arguments may be required, variadic, or restricted to documented values. Options declare every literal spelling and may accept one value.

`CommandRuntime` defines the generic `catalog` and `execute` operations once for every command extension. A runtime adapter joins extensions published by active facets with its authoritative command registry and implements that capability. The execution context id remains opaque to the standard; a DSH adapter maps it to a session. Results contain only the command outcome. Invocation-scoped UI work uses typed clients from `@dsh-std/presentation`.

`commandRuntime()` wraps a consumer-scoped `CapabilityClient` with typed methods, and `commandRuntimeImplementation()` builds the operation dispatcher for an adapter. Consumers and adapters do not repeat operation strings or payload validation.

Presentation clients can build completion trees and forms without importing the owning component. A component such as dsh-codex declares `Command/codex`; its selected facet publishes the handler in its local runtime and never defines a connection-specific method.

Names and aliases are single tokens. Sibling names and aliases, argument names, option spellings, and enumerated values must be unique. A variadic argument must be last.

## Extension points

Fields prefixed with `x-` may carry experimental metadata. Portable clients ignore extensions they do not understand. Incompatible command semantics require a new contract major version rather than redefining an existing field.

## Known Limitations and Deferred Work

- The contract does not define a command-line parser or quoting rules.
- Dynamic completion is not part of `v1alpha1`; declared values are static.
