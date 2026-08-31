# Changelog

Changes to `@dsh-std/manifest` are recorded here.

## 0.1.1-rc.2

- Preserved a Community contribution's fully-qualified `id` as its activation publication alias while retaining the protocol-valid normalized extension name.

## 0.1.1-rc.1

- Allowed empty `requires`, `permissions`, `contributes`, and `subscriptions` containers to be omitted without changing Community v0.15 projection semantics.
- Preserved every manifest accepted by `0.1.0-rc1`.

## 0.1.0-rc1

- Added Community v0.15 manifest parsing and validation.
- Added definition catalogs for independently installed extension protocols.
- Kept activation, compatibility, and runtime availability separate from manifest validity.
