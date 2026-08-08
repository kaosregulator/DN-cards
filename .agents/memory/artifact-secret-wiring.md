---
name: Managed artifact secret wiring
description: Shared Replit Secrets need explicit name-only environment references in managed artifact services.
---

Managed artifact services did not inherit the existing shared Replit Secrets until their service environment included `${SECRET_NAME}` references. Keep secret values only in Replit Secrets; never copy them into artifact.toml or source.

**Why:** The API and Activity workflows started without the stored Discord secret names, leaving Activity configured=false even though all four secrets existed.

**How to apply:** For server secrets, add name-only references under the API artifact's `[services.env]`; for Vite build variables, add the reference to the Activity artifact's `[services.env]`. If an Activity artifact is registered at `/` while another web artifact already owns `/`, use its configured service path (`/activity`) as the artifact preview path before validator replacement.