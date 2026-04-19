// signals — Azure infrastructure for a single-tenant, privacy-first
// site-observability tool. The data plane sits in australiaeast; SWA sits
// in eastasia because no AU region is available for SWA.
//
// Auth model: the Function App's system-assigned managed identity is granted
// Storage Blob Data Owner (for its own Flex Consumption deployment container
// and AzureWebJobsStorage internal state) and Storage Table Data Contributor
// (for the events/rollups tables) directly on the storage account. There is
// no connection string and no Key Vault in the hot path.

targetScope = 'resourceGroup'

@description('App name prefix for CAF naming')
param appName string = 'signals'

@description('Primary region for storage, compute, monitoring, Logic App')
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

@description('Explicit list of origins allowed to POST to /api/collect. Leave default for production; widen in dev/staging via parameters file.')
param corsAllowedOrigins array = [
  'https://${siteId}'
  'https://www.${siteId}'
]

// --- Derived names -----------------------------------------------------------

var uniqueSuffix = uniqueString(resourceGroup().id)
var storageAccountName = 'st${appName}${uniqueSuffix}'
var staticWebAppName = 'stapp-${appName}-${uniqueSuffix}'
var applicationInsightsName = 'appi-${appName}-${uniqueSuffix}'
var logAnalyticsWorkspaceName = 'log-${appName}-${uniqueSuffix}'
var functionAppName = 'func-${appName}-${uniqueSuffix}'
var hostingPlanName = 'asp-${appName}-${uniqueSuffix}'
var logicAppName = 'logic-${appName}-daily-${uniqueSuffix}'
var deploymentContainerName = 'function-deployments'

// Built-in role definition IDs — stored as vars for readability at the
// role-assignment use sites.
var storageBlobDataOwnerRoleId = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var storageTableDataContributorRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'

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
    deploymentContainerName: deploymentContainerName
    location: location
    tags: commonTags
  }
}

module functionapp 'modules/functionapp.bicep' = {
  name: 'functionapp-deploy'
  params: {
    functionAppName: functionAppName
    hostingPlanName: hostingPlanName
    location: location
    storageAccountName: storage.outputs.name
    deploymentContainerName: deploymentContainerName
    applicationInsightsConnectionString: monitoring.outputs.applicationInsightsConnectionString
    dailyApiKeys: dailyApiKeys
    mcpApiKeys: mcpApiKeys
    signalsMode: signalsMode
    siteId: siteId
    timezone: timezone
    corsAllowedOrigins: corsAllowedOrigins
    tags: commonTags
  }
}

module swa 'modules/swa.bicep' = {
  name: 'swa-deploy'
  params: {
    staticWebAppName: staticWebAppName
    location: staticWebAppLocation
    tags: commonTags
  }
}

module logicapp 'modules/logicapp.bicep' = {
  name: 'logicapp-deploy'
  params: {
    logicAppName: logicAppName
    location: location
    functionAppDefaultHostname: functionapp.outputs.defaultHostname
    dailyRawKey: dailyRawKey
    tags: commonTags
  }
}

// --- Role assignments --------------------------------------------------------

// `existing` reference with a known-at-start name lets the role-assignment
// `scope` be resolvable before the storage module runs. The actual resource
// still needs to be created first (implicit dependency via storage module).
resource storageAccountExisting 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
  dependsOn: [storage]
}

// Role-assignment names must be computable at start, so they use the
// resource-name vars directly (not module outputs). The `principalId` in
// properties is a module output and is resolved lazily, which is allowed.
resource funcBlobOwnerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccountName, functionAppName, storageBlobDataOwnerRoleId)
  scope: storageAccountExisting
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataOwnerRoleId)
    principalId: functionapp.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

resource funcTableContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccountName, functionAppName, storageTableDataContributorRoleId)
  scope: storageAccountExisting
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageTableDataContributorRoleId)
    principalId: functionapp.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

// --- Outputs -----------------------------------------------------------------

output staticWebAppName string = swa.outputs.name
output staticWebAppUrl string = 'https://${swa.outputs.defaultHostname}'
output functionAppName string = functionapp.outputs.name
output functionAppUrl string = 'https://${functionapp.outputs.defaultHostname}'
output storageAccountName string = storage.outputs.name
output storageTableEndpoint string = storage.outputs.tableEndpoint
output applicationInsightsName string = monitoring.outputs.applicationInsightsName
output logicAppName string = logicapp.outputs.name
