# Changelog

Changes to `@dsh-std/core` are recorded here.

## 0.1.1-rc.1

- Added the exact declared protocol coordinate to requirement and support validation context so one definition can validate each accepted `apiVersion` without duplicating version fields in `spec`.
- Preserved rc1 definitions whose validators only consume the original `spec` argument.

## 0.1.0-rc1

- Defined protocol coordinates, participant declarations, definition catalogs, and negotiation reports.
- Separated evaluator knowledge, requirements, potential support, and live support.
