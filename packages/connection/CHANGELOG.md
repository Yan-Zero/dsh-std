# Changelog

Changes to `@dsh-std/connection` are recorded here.

## 0.1.1-rc.1

- Plan digests now hash the digest-stripped agreement with SHA-256 over its deterministic CBOR encoding (RFC 8949 core deterministic subset), rendered as `sha256:` plus 64 lowercase hex digits, replacing the 32-bit FNV-1a hash of a JSON-ish canonical string that covered only part of the agreement. The encoder drops `undefined`-valued map properties (the agreement's JSON wire projection) and rejects every other `undefined`, non-integer or unsafe number, unpaired surrogate, and non-plain object instead of colliding.
- Documented the `resolveConnection` offer order convention: `left` is the coordinator (initiator) offer and both parties must resolve with the offers in the same order for digests to compare equal.
- Aligned the package with the workspace `0.1.1` prerelease line without changing the existing Connection protocol semantics.

## 0.1.0-rc1

- Defined connection services, endpoint views, participant publication, capability bindings, and attachments.
- Added an in-memory transport for protocol conformance and host integration tests.
