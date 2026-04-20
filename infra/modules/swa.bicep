// Static Web App (Free) with Managed Functions. API handlers are
// deployed as part of the static deploy (`swa deploy --api-location`)
// and read their storage connection string from the SWA's app settings.
// Timekeeper reference pattern — proven in production, no MI or KV
// plumbing required.

param staticWebAppName string
param location string
param storageAccountName string
param applicationInsightsConnectionString string
param signalsMode string
param siteId string
param timezone string
param tags object = {}

@secure()
param dailyApiKeys string

@secure()
param mcpApiKeys string = ''

@secure()
param adminApiKeys string = ''

@description('GitHub OAuth App client ID — stored in app settings and referenced by clientIdSettingName in staticwebapp.config.json.')
@secure()
param githubClientId string

@description('GitHub OAuth App client secret — stored in app settings and referenced by clientSecretSettingName in staticwebapp.config.json.')
@secure()
param githubClientSecret string

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

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

// The storage connection string is built inline from listKeys() at deploy
// time and stored as a plain app setting — same as Timekeeper. KV
// references would in principle rotate without redeploy, but SWA
// Managed Functions had unreliable KV-reference resolution in earlier
// experiments, and the single-tenant blast radius makes the rotation
// benefit largely theoretical here.
resource staticWebAppSettings 'Microsoft.Web/staticSites/config@2023-01-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: union({
    STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
    SIGNALS_MODE: signalsMode
    SIGNALS_SITE_ID: siteId
    APPLICATIONINSIGHTS_CONNECTION_STRING: applicationInsightsConnectionString
    DAILY_API_KEYS: dailyApiKeys
    GITHUB_CLIENT_ID: githubClientId
    GITHUB_CLIENT_SECRET: githubClientSecret
    NODE_ENV: 'production'
    TZ: timezone
  }, !empty(mcpApiKeys) ? {
    MCP_API_KEYS: mcpApiKeys
  } : {}, !empty(adminApiKeys) ? {
    ADMIN_API_KEYS: adminApiKeys
  } : {})
}

output name string = staticWebApp.name
output defaultHostname string = staticWebApp.properties.defaultHostname
