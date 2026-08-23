# Changelog

Changes to `@dsh-std/storage` are recorded here.

## 0.1.1-rc.1

- Added negotiated `presence` and paginated `list` features while keeping the rc1 requirement, support, binding, and get/set/delete surface valid.
- Added `has` to distinguish a missing key from a stored JSON `null` when the feature is negotiated.

## 0.1.0-rc1

- Defined scoped local JSON storage get, set, and delete operations.
- Added permission names, schemas, validators, and deterministic provider negotiation.
