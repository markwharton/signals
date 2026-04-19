import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";

const ENDPOINT_ENV = "STORAGE_TABLE_ENDPOINT";

let cachedCredential: DefaultAzureCredential | undefined;

/**
 * Return a TableClient for the given table name, authenticating with the
 * SWA's system-assigned managed identity. The MI is granted "Storage Table
 * Data Contributor" on the storage account by infra, so no connection string
 * or secret is required at runtime.
 */
export function getTableClient(tableName: string): TableClient {
  const endpoint = process.env[ENDPOINT_ENV];
  if (!endpoint) {
    throw new Error(
      `Missing ${ENDPOINT_ENV} environment variable — expected a Storage` +
        ` Table endpoint like https://<account>.table.core.windows.net/.`,
    );
  }
  cachedCredential ??= new DefaultAzureCredential();
  return new TableClient(endpoint, tableName, cachedCredential);
}

export const TABLE_EVENTS = "events";
export const TABLE_ROLLUPS = "rollups";
