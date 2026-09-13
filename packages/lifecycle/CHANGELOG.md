# Changelog

Changes to `@dsh-std/lifecycle` are recorded here.

## 0.1.1-rc.3

- Made cleanup disposers awaitable and settlement-stable: manual disposal and scope shutdown now share one in-flight cleanup instead of allowing teardown to finish around unfinished work.

## 0.1.1-rc.2

- Resolve extension publications by either normalized `metadata.name` or a preserved Community contribution id, rejecting ambiguous aliases.

## 0.1.1-rc.1

- Aligned the package with the workspace `0.1.1` prerelease line without changing the existing Lifecycle protocol semantics.

## 0.1.0-rc1

- Defined facet activation instances, publication barriers, cleanup scopes, rollback, and deactivation.
- Added activation-driver and owner-bound registration contracts.
