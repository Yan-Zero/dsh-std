# Changelog

Changes to `@dsh-std/connection` are recorded here.

## 0.1.1-rc.2

- Plan digests now hash the digest-stripped agreement with SHA-256 over its deterministic CBOR encoding (RFC 8949 core deterministic subset), rendered as `sha256:` plus 64 lowercase hex digits, replacing the 32-bit FNV-1a hash of a JSON-ish canonical string that covered only part of the agreement.
- Aligned digest input with the Connection Wire data model: byte strings retain their bytes, `undefined`-valued map properties are omitted as absent fields, and every other `undefined`, negative or unsafe integer, unpaired surrogate, cyclic value, and non-plain object is rejected instead of colliding or producing an out-of-profile plan.
- Defined the `resolveConnection` offer order convention (`left` is coordinator), and normalized protocols, participants, bindings, and issues by deterministic-CBOR byte order so host locale collation cannot change binding IDs or plan digests.

## 0.1.1-rc.1

- Aligned the package with the workspace `0.1.1` prerelease line.

## 0.1.0-rc1

- Defined connection services, endpoint views, participant publication, capability bindings, and attachments.
- Added an in-memory transport for protocol conformance and host integration tests.
