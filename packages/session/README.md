# `@dsh-std/session`

This package defines session-domain extensions. `SessionEvent` declares a durable event type owned by a component. Product adapters map the declaration to their session store and bind that registration to the facet owner.

It is not a global event bus. Runtime observation and interception belong to `@dsh-std/events`; persistence, replay, and unknown-type handling belong to the session domain.
