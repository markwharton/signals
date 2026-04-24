import { TableClient } from "@azure/data-tables";

const CONNECTION_ENV = "STORAGE_CONNECTION_STRING";

/**
 * Return a TableClient for the given table name, built from the plain
 * connection string in STORAGE_CONNECTION_STRING. Written to SWA app
 * settings by the Bicep template at deploy time — no KV reference, no
 * managed identity in the hot path.
 */
export function getTableClient(tableName: string): TableClient {
  const connectionString = process.env[CONNECTION_ENV];
  if (!connectionString) {
    throw new Error(
      `Missing ${CONNECTION_ENV} environment variable — expected a plain` +
        ` storage connection string written by the SWA Bicep at deploy time.`,
    );
  }
  return TableClient.fromConnectionString(connectionString, tableName);
}

export const TABLE_EVENTS = "events";
export const TABLE_ROLLUPS = "rollups";
export const TABLE_SALTS = "salts";
