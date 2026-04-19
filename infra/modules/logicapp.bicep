// Consumption-tier Logic App that POSTs to the Function App's /api/daily
// at 17:00 UTC (03:00 Brisbane next day). The raw API key is held here in
// plaintext; /api/daily validates it against the hashed entries in
// DAILY_API_KEYS on the Function App. One-way trust: only this Logic App
// invokes /api/daily.

param logicAppName string
param location string
param functionAppDefaultHostname string
param tags object = {}

@secure()
param dailyRawKey string

resource dailyLogicApp 'Microsoft.Logic/workflows@2019-05-01' = {
  name: logicAppName
  location: location
  tags: tags
  properties: {
    state: 'Enabled'
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      triggers: {
        Recurrence: {
          type: 'Recurrence'
          recurrence: {
            frequency: 'Day'
            interval: 1
            schedule: {
              hours: [17]
              minutes: [0]
            }
            timeZone: 'UTC'
          }
        }
      }
      actions: {
        Daily: {
          type: 'Http'
          inputs: {
            method: 'POST'
            uri: 'https://${functionAppDefaultHostname}/api/daily'
            headers: {
              'x-api-key': dailyRawKey
            }
          }
        }
      }
    }
  }
}

output name string = dailyLogicApp.name
