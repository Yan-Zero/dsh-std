# @dsh-std/manifest

Static Community v0.15 `dsh-plugin.json` object model, JSON Schema, validator, and Host-internal projection. `manifestVersion` selects the built-in parser. `parseManifest()` checks that `$schema` is an absolute URI but neither pins it to a nonexistent canonical URL nor fetches it from the network.

The package exports its local draft schema as `@dsh-std/manifest/schema/dsh-plugin-0.15.schema.json`. This is a packaged validation asset, not a claim that community#24 has assigned a canonical schema URI.
