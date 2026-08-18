# @dsh-std/presentation

English | [中文](README.zh.md)

Small, invocation-scoped operations that a runtime facet may request from a connected presentation client.

## Contracts

`v1alpha1` defines five independent presentation protocols:

- `OpenExternal` asks the client to open an HTTP or HTTPS URI.
- `CopyText` asks the client to copy text to its clipboard.
- `Notification` asks the client to display informational, warning, or error text.
- `UserInteraction` carries structured questions, one-invocation approvals, and secret input.
- `ExternalRedirect` receives a one-shot HTTP redirect on the user side and may reserve an exact loopback URI requested by the consumer.

A facet declares each required operation in its manifest. A client advertises only the protocols it can perform for the current connection. The runtime admits the command only when all required presentation protocols are available, and it accepts only operations declared by that facet. Operations belong to the active invocation; they are not a global event bus or a persistent client capability.

The package provides protocol definitions, invocation-scoped typed client and implementation binders, and request/result validation. The Host binds request identity and origin when it creates a client; consumers supply only operation-specific input. It does not perform UI work. Native applications, terminals, browsers, editors, and automation clients may implement different subsets.

Simple operations are available from `@dsh-std/presentation/operations`, while interaction types are available from `@dsh-std/presentation/interaction`. A Host-provided `PresentationDescriptor` is only a projection of active agreements for the current invocation; it is not a separate Snapshot protocol.

## Known Limitations and Deferred Work

- `OpenExternal` intentionally rejects non-HTTP(S) URI schemes.
- Clipboard reads, arbitrary UI trees, and file pickers are not defined.
- Delivery acknowledgement and durable replay are outside `v1alpha1`.
