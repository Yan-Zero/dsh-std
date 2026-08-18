# Changelog

Changes to `@dsh-std/adapter-dsh` are recorded here.

## 0.1.0-rc2

- Replaced the Web-only, profile-gated client mapping with a capability-gated DSH browser-client adapter.
- Added product-owned command surface providers so standard commands are projected only onto declared placement coordinates.
- Kept browser component discovery pending until the native client-module host becomes available.
- Moved the optional browser-realm surface ABI to `@dsh-std/ui-browser`; portable components no longer import the DSH adapter client entrypoint.
- Exported `package.json` so DSH client-module discovery can include the adapter's browser entry.
- Added the strict Host-side Typert artifact and browser Remote used by standard UI facets to execute negotiated commands.

## 0.1.0-rc1

- Added DeepSeek Harness bootstrap, manifest discovery, facet activation, and standard participant publication.
- Added DSH mappings for commands, models, tools, sessions, presentation, workspace, and connection.
- Added host-owned binary and workspace file facilities while preserving DSH policy and approval boundaries.
- Added a Web-only `dsh.client` adapter that maps negotiated local UI facets to native settings and tool-view slots, with profile gating and activation-owned cleanup.
- Aligned the adapter's DSH development baseline with `0.1.0-rc.7` for agent, command, LLM, and session type identity.
