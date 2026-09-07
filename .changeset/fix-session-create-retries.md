---
"@dsh-std/adapter-dsh": patch
---

Prevent SessionCatalog create retries from overwriting later title edits. Preserve the existing request-to-session mapping, retain completed results, reject changed input, and recover partial native operations without repeating committed title writes.
