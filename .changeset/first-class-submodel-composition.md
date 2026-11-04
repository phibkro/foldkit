---
'foldkit': minor
---

Define synchronous Submodels with `Submodel.define` and share their parent relationship through `Submodel.bind`. The binding lifts initialization, update, Commands, OutMessages, views, and Subscriptions without adding loading state to eager children. Views declared inside `define` receive the child Message type automatically.

Lazy hosts implement the same composition interface. Bindings expose runtime preparation and restoration hooks, preserve typed arguments and service requirements, and cache lifted Subscription entries with names scoped to each binding. Existing composition helpers and host entry points are supported.
