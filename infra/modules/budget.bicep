// Monthly cost budget for the resource group with email notifications
// at 50% actual, 100% actual, and 100% forecasted. Catches runaway spend
// (accidental traffic loops, log-write storms) before it gets expensive.

param budgetName string
param amount int
param contactEmails array

@description('YYYY-MM-01 — Azure requires the first of the month for monthly budgets. Defaults to the current month.')
param startDate string = utcNow('yyyy-MM-01')

@description('Far-future end date; Azure requires one but it only limits when evaluation stops.')
param endDate string = '2035-01-01'

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: budgetName
  properties: {
    amount: amount
    category: 'Cost'
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
      endDate: endDate
    }
    notifications: {
      actual50: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 50
        thresholdType: 'Actual'
        contactEmails: contactEmails
      }
      actual100: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: contactEmails
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: contactEmails
      }
    }
  }
}

output name string = budget.name
