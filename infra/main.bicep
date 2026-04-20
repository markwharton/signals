// signals — Azure infrastructure for a single-tenant, privacy-first
// site-observability tool. The data plane sits in australiaeast; SWA sits
// in eastasia because no AU region is available for SWA.
//
// Pattern mirrors ~/Projects/markwharton/timekeeper: SWA Free plan hosts
// Managed Functions that read a plain storage connection string from app
// settings. A Logic App drives the daily rollup via an HTTP POST to
// /api/daily, because SWA Managed Functions support HTTP triggers only.
// No separate Function App, no Key Vault references, no managed identity.

targetScope = 'resourceGroup'

@description('App name prefix for CAF naming')
param appName string = 'signals'

@description('Primary region for storage, monitoring, Logic App')
param location string = 'australiaeast'

@description('SWA region — limited availability, no AU region')
param staticWebAppLocation string = 'eastasia'

@description('Environment — surfaced as a resource tag; not embedded in resource names (RG name carries env)')
@allowed(['prod', 'dev', 'test'])
param environment string = 'prod'

@description('Site this deployment tracks (used in partition keys)')
param siteId string = 'plankit.com'

@description('Mode: counter (v1) or signal (future)')
@allowed(['counter', 'signal'])
param signalsMode string = 'counter'

@description('Timezone for the app (TZ env var)')
param timezone string = 'Australia/Brisbane'

@description('Raw API key for Logic App → /api/daily (generated via scripts/generate-api-key.ts)')
@secure()
param dailyRawKey string

@description('Hashed API key entries for /api/daily (sourceId:sha256:hash, comma-separated)')
@secure()
param dailyApiKeys string

@description('Hashed API key entries for /api/mcp (sourceId:sha256:hash, comma-separated; optional)')
@secure()
param mcpApiKeys string = ''

@description('GitHub OAuth App client ID for SWA auth. Create the OAuth app at https://github.com/settings/developers with callback https://<swa-hostname>/.auth/login/github/callback.')
@secure()
param githubClientId string

@description('GitHub OAuth App client secret (companion to githubClientId).')
@secure()
param githubClientSecret string

@description('Monthly cost ceiling (currency follows the billing account) for the resource group. Set ~5x normal burn to catch anomalies without firing on noise — with SWA Free + Logic App + Storage, real burn is ~$0-2/month.')
param monthlyBudgetAmount int = 10

@description('Emails that receive budget notifications at 50% actual, 100% actual, and 100% forecasted.')
param budgetContactEmails array = [
  'mark@jynx.com'
]

// --- Derived names -----------------------------------------------------------

var uniqueSuffix = uniqueString(resourceGroup().id)
var storageAccountName = 'st${appName}${uniqueSuffix}'
var staticWebAppName = 'stapp-${appName}-${uniqueSuffix}'
var applicationInsightsName = 'appi-${appName}-${uniqueSuffix}'
var logAnalyticsWorkspaceName = 'log-${appName}-${uniqueSuffix}'
var logicAppName = 'logic-${appName}-daily-${uniqueSuffix}'

var commonTags = {
  app: appName
  environment: environment
}

// --- Modules -----------------------------------------------------------------

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring-deploy'
  params: {
    logAnalyticsWorkspaceName: logAnalyticsWorkspaceName
    applicationInsightsName: applicationInsightsName
    location: location
    tags: commonTags
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage-deploy'
  params: {
    storageAccountName: storageAccountName
    location: location
    tags: commonTags
  }
}

module swa 'modules/swa.bicep' = {
  name: 'swa-deploy'
  params: {
    staticWebAppName: staticWebAppName
    location: staticWebAppLocation
    storageAccountName: storage.outputs.name
    applicationInsightsConnectionString: monitoring.outputs.applicationInsightsConnectionString
    signalsMode: signalsMode
    siteId: siteId
    timezone: timezone
    dailyApiKeys: dailyApiKeys
    mcpApiKeys: mcpApiKeys
    githubClientId: githubClientId
    githubClientSecret: githubClientSecret
    tags: commonTags
  }
}

module logicapp 'modules/logicapp.bicep' = {
  name: 'logicapp-deploy'
  params: {
    logicAppName: logicAppName
    location: location
    swaDefaultHostname: swa.outputs.defaultHostname
    dailyRawKey: dailyRawKey
    tags: commonTags
  }
}

module budget 'modules/budget.bicep' = {
  name: 'budget-deploy'
  params: {
    budgetName: 'budget-${appName}-${environment}'
    amount: monthlyBudgetAmount
    contactEmails: budgetContactEmails
  }
}

// --- Outputs -----------------------------------------------------------------

output staticWebAppName string = swa.outputs.name
output staticWebAppUrl string = 'https://${swa.outputs.defaultHostname}'
output storageAccountName string = storage.outputs.name
output storageTableEndpoint string = storage.outputs.tableEndpoint
output applicationInsightsName string = monitoring.outputs.applicationInsightsName
output logicAppName string = logicapp.outputs.name
