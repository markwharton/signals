// Static Web App (Free) for static assets only — dashboard + beacon.js.
// The API lives on a separate Flex Consumption Function App, so the SWA
// doesn't need a managed identity, app settings, or a linked Functions
// backend. Beacon cross-posts to the Function App origin; see
// packages/beacon for the data-endpoint convention.

param staticWebAppName string
param location string
param tags object = {}

resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: staticWebAppName
  location: location
  tags: tags
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
  }
}

output name string = staticWebApp.name
output defaultHostname string = staticWebApp.properties.defaultHostname
