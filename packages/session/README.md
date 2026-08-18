# `@dsh-std/session`

This package defines session-domain extensions. `SessionEvent` declares a durable event type owned by a component. Product adapters map the declaration to their session store. Once an adapter has observed a durable event type, it keeps that type recognizable for the rest of the process so facet reload or unload cannot make existing history unreadable.

It is not a global event bus. Runtime observation and interception belong to `@dsh-std/events`; persistence, replay, and unknown-type handling belong to the session domain.
