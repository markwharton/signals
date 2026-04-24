// Storage account + Tables (events, rollups, salts). Auth is via
// connection string read from the SWA app settings at function runtime
// — no MI, no role assignments, no deployment container. Matches
// Timekeeper's reference pattern.
//
// `salts` is only written on signal-mode deploys (one row per
// (site, yyyymmdd) carrying that day's random 32-byte visitor-hash
// salt). The table is provisioned unconditionally so counter-mode
// deploys can flip to signal mode without a separate infra step.

param storageAccountName string
param location string
param tags object = {}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource eventsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'events'
}

resource rollupsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'rollups'
}

resource saltsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'salts'
}

output name string = storageAccount.name
output id string = storageAccount.id
output tableEndpoint string = storageAccount.properties.primaryEndpoints.table
