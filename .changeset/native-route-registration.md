---
'foldkit': minor
---

Add `Route.register` and `Route.catalog` to associate URL parsers with typed entry, stay, exit, and prefetch policies. Navigation returns parent Update Steps and preserves Command service requirements. Catalogs parse complete URLs in registration order, run exits before entries, and reject duplicate tags. Lazy route callbacks compose the existing Submodel host, with parent-owned state, instance identity, and restoration policy.
