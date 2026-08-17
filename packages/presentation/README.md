# @dsh-std/presentation

English | [中文](README.zh.md)

Small, invocation-scoped operations that a runtime facet may request from a connected presentation client.

## Contracts

`v1alpha1` defines three independent presentation protocols:

- `OpenExternal` asks the client to open an HTTP or HTTPS URI.
- `CopyText` asks the client to copy text to its clipboard.
- `Notification` asks the client to display informational, warning, or error text.

A facet declares each required operation in its manifest. A client advertises only the protocols it can perform for the current connection. The runtime admits the command only when all required presentation protocols are available, and it accepts only operations declared by that facet. Operations belong to the active invocation; they are not a global event bus or a persistent client capability.

The package validates data but does not perform UI work. Native applications, terminals, browsers, editors, and automation clients may implement different subsets.

## Known Limitations and Deferred Work

- `OpenExternal` intentionally rejects non-HTTP(S) URI schemes.
- Clipboard reads, arbitrary dialogs, file pickers, and secret prompts are not defined.
- Delivery acknowledgement and durable replay are outside `v1alpha1`.
