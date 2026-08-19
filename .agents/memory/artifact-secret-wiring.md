---
name: Managed artifact secret wiring
description: Shared Replit Secrets need explicit name-only environment references in managed artifact services.
---

Managed artifact services need explicit `${SECRET_NAME}` references. Keep secret values only in Replit Secrets; never copy them into artifact.toml or source. A missing reference is delivered as literal `${NAME}`, so treat templated strings as absent configuration rather than truthy values.

**Why:** A literal placeholder can make an OAuth service appear configured while invalidating every launch. Managed development workflows may also retain placeholders, so local process env alone cannot prove production secret injection.

**How to apply:** For server secrets, add name-only references under the API artifact's `[services.env]` and validate them before use. For a Vite public identifier, inject a same-name runtime env at build time via Vite config; aliasing it directly to a different Vite variable can remain unresolved. If an Activity artifact is registered at `/` while another web artifact already owns `/`, use its configured service path (`/activity`) as the artifact preview path before validator replacement.