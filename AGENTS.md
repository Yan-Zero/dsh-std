# Repository instructions

## Scope

`dsh-std` defines implementation-independent protocols for the DSH ecosystem. It is not a product runtime and does not prescribe the internal architecture of DSH, dsh-host, dsh-TUI, Web, GUI, or any plugin.

`@dsh-std/core` is the meta-protocol for declaring, discovering, and negotiating independently versioned protocols. It must not absorb domain behavior merely because several domain packages use it.

Product-specific integration belongs in an adapter such as `@dsh-std/adapter-dsh`. Portable protocol packages must not import an adapter or a product runtime.

## Protocol changes

- Every public protocol package or material protocol change must have a corresponding document under `docs/proposals/`.
- Keep the proposal, exported types, validators, schemas, conformance fixtures, and tests consistent.
- A protocol's authority is determined by its specification and coordinates, not by which repository currently supplies its implementation.
- Private protocols use their own namespaced `apiVersion` and participate through the same core declaration and negotiation mechanism as public protocols.
- Do not make one protocol depend on unrelated protocols unless its normative semantics require that dependency.
- Do not turn an implementation convenience, current repository layout, or one product's limitation into a normative requirement.

## Proposal style

Write proposals as protocol specifications in an RFC-like register.

- State the protocol scope, terminology, data model, required behavior, negotiation rules, lifecycle, errors, security considerations, and compatibility rules where applicable.
- Use normative language consistently: MUST / MUST NOT / SHOULD / SHOULD NOT / MAY, with Chinese equivalents when the document is Chinese.
- Describe observable behavior and interoperability requirements. Examples and rationale may clarify the specification but must not replace it.
- Do not write implementation roadmaps, task lists, progress reports, repository refactoring plans, self-criticism, retrospective narration, or notes about what the author is about to code.
- Do not name a particular project as the designated reference implementation in a protocol proposal.
- Do not present unresolved implementation work as a protocol requirement. Genuine unresolved protocol questions may appear only when the proposal status permits them.
- Preserve stable document paths when replacing duplicated material; use a concise normative reference instead of deleting a path that downstream readers may already follow.

## Verification and repository hygiene

- Use `pnpm check` after changing code, schemas, package metadata, or conformance behavior.
- Use `git diff --check` before handing off changes.
- Preserve unrelated user changes in a dirty worktree.
