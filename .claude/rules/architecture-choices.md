---
description: Where signals deviates from the brief and why
---

# Architecture Choices

## SWA static + Flex Consumption Function App (not SWA Managed Functions)

The brief specified SWA Managed Functions. SWA MF doesn't expose
managed identity to Function code in a form `@azure/identity` can
consume — MI → Storage failed with "Cannot read properties of
undefined (reading 'expires_on')". KV-referenced connection strings
also didn't resolve at runtime.

Split the API into a standalone Flex Consumption Function App with its
own system-assigned MI; SWA reverted to Free for static only. Costs
~$5/month more than Managed Functions, requires cross-origin CORS and
a `data-endpoint` attribute on the beacon, but gets clean MI → Tables
auth and the full Functions trigger surface. The Logic App stays —
its portal-visible scheduling has value the pivot didn't override.
