# Changesets

Every pull request that changes a published package should include a changeset:

```sh
pnpm changeset
```

Select the affected packages, choose the appropriate semantic version bump, and
commit the generated Markdown file with the pull request. Documentation-only,
test-only, and internal maintenance changes do not require a changeset.

The unscoped `dsh-std` namespace guard is intentionally excluded from automated
versioning and publishing.
