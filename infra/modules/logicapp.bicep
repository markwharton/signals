// Consumption-tier Logic App that POSTs to the SWA's /api/daily at 17:00
// UTC (03:00 Brisbane next day). The raw API key is held here in plaintext;
// /api/daily validates it against the hashed entries in DAILY_API_KEYS on
// the SWA. One-way trust: only this Logic App invokes /api/daily.
//
// A timer trigger inside the function would be simpler, but SWA Managed
// Functions only supports HTTP triggers — the Logic App is the scheduler.

param logicAppName string
param location string
param swaDefaultHostname string
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
            // Explicit ?days=1 so the scheduled run doesn't silently
            // shift if the handler default ever changes. Manual
            // re-rolls go through scripts/rollup.ts with ?date= override.
            uri: 'https://${swaDefaultHostname}/api/daily?days=1'
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
