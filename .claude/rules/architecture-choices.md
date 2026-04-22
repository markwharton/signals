---
description: Where signals deviates from the brief and why
---

# Architecture Choices

## SWA Managed Functions: connection string for Storage, not managed identity

SWA Managed Functions doesn't surface a managed identity to Function
code in a form `@azure/identity` can consume — attempts to use MI →
Storage fail with "Cannot read properties of undefined (reading
'expires_on')". Key Vault references in app settings also didn't
resolve at runtime.

We use connection-string-based auth for Storage (set as an app setting
on the SWA), and accept that v1 doesn't get MI-based key rotation. A
previous attempt to split the API into a standalone Flex Consumption
Function App with its own MI was tried and reverted (`f6e7179`) — the
cost delta, cross-origin CORS, and `data-endpoint` beacon attribute
weren't worth the rotation story for v1.
