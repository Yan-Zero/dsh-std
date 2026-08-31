# `@dsh-std/session`

This package defines provider-scoped Session identity and three independently usable protocol surfaces. `SessionCatalog` lists and manages descriptors, `SessionHistory` reads, follows, and forks durable history, and `SessionEvent` declares a durable event type owned by a component.

Catalog and History are separate capabilities, so metadata access does not grant history access. Workspace membership remains owned by `@dsh-std/workspace`; Session creation and fork do not attach a Workspace implicitly.

This package is not a global event bus. Durable Session facts have one observation surface: `SessionHistory.read()` and `follow()`, with provider cursors and replay semantics. Ordinary History clients cannot append arbitrary events.
