// Flex Consumption Function App + hosting plan. The app uses its
// system-assigned managed identity to authenticate to Azure Tables and to
// read its own deployment zip from the storage blob container — there is
// no connection string and no Key Vault hop for the data plane.

param functionAppName string
param hostingPlanName string
param location string
param storageAccountName string
param deploymentContainerName string
param applicationInsightsConnectionString string
param signalsMode string
param siteId string
param timezone string
param tags object = {}

@description('Upper bound on concurrent instances for the Flex Consumption plan.')
param maximumInstanceCount int = 40

@description('Per-instance memory, in MB. Valid values for Flex Consumption: 512, 2048, 4096.')
param instanceMemoryMB int = 2048

@secure()
param dailyApiKeys string

@secure()
param mcpApiKeys string = ''

var storageTableEndpoint = 'https://${storageAccountName}.table.${environment().suffixes.storage}/'
var deploymentStorageUrl = 'https://${storageAccountName}.blob.${environment().suffixes.storage}/${deploymentContainerName}'

resource hostingPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: hostingPlanName
  location: location
  tags: tags
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: hostingPlan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: deploymentStorageUrl
          authentication: {
            type: 'SystemAssignedIdentity'
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: maximumInstanceCount
        instanceMemoryMB: instanceMemoryMB
      }
      runtime: {
        name: 'node'
        version: '20'
      }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'FtpsOnly'
      cors: {
        allowedOrigins: ['*']
        supportCredentials: false
      }
      appSettings: concat([
        {
          name: 'AzureWebJobsStorage__accountName'
          value: storageAccountName
        }
        {
          name: 'STORAGE_TABLE_ENDPOINT'
          value: storageTableEndpoint
        }
        {
          name: 'DAILY_API_KEYS'
          value: dailyApiKeys
        }
        {
          name: 'SIGNALS_MODE'
          value: signalsMode
        }
        {
          name: 'SIGNALS_SITE_ID'
          value: siteId
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: applicationInsightsConnectionString
        }
        {
          name: 'NODE_ENV'
          value: 'production'
        }
        {
          name: 'TZ'
          value: timezone
        }
      ], !empty(mcpApiKeys) ? [
        {
          name: 'MCP_API_KEYS'
          value: mcpApiKeys
        }
      ] : [])
    }
  }
}

output name string = functionApp.name
output defaultHostname string = functionApp.properties.defaultHostName
output principalId string = functionApp.identity.principalId
