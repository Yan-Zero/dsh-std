# @dsh-std/ui

`@dsh-std/ui` defines the domain-neutral envelope for UI surface negotiation and activation-scoped contributions. Products own concrete surface coordinates, descriptor schemas, renderers, and adapters.

`host-rendered` contributions contain JSON data. `local-module` contributions additionally carry a same-process executable value and must never cross an endpoint.
