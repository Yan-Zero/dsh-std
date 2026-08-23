# Changelog

Changes to `@dsh-std/presentation` are recorded here.

## 0.1.1-rc.1

- Aligned the package with the workspace `0.1.1` prerelease line without changing the existing Presentation protocol semantics.

## 0.1.0-rc1

- Defined invocation-scoped `OpenExternal`, `CopyText`, `Notification`, `UserInteraction`, and `ExternalRedirect` capabilities.
- Added typed question, approval, secret-input, and one-shot loopback redirect flows.
- Added optional exact loopback callback URIs with explicit-port validation, no-substitution semantics, and address-in-use failure reporting.
