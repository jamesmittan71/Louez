import { randomBytes } from "node:crypto";

import mysql from "mysql2/promise";

export interface TestDatabase {
  drop(): Promise<void>;
}

// This test-only bootstrap configures DATABASE_URL before the DB env module loads.
export function skipWithoutTestDatabase(): string | false {
  return process.env.TEST_DATABASE_URL || process.env.CI ? false : "TEST_DATABASE_URL is not set";
}

export async function createTestDatabase(suite: string): Promise<TestDatabase> {
  const serverUrl = process.env.TEST_DATABASE_URL;
  if (!serverUrl) throw new Error("TEST_DATABASE_URL is not set");

  const name = `louez_${suite.toLowerCase().replace(/[^a-z0-9_]/g, "_")}_${randomBytes(4).toString("hex")}`;
  const server = new URL(serverUrl);
  server.pathname = "/";
  const database = new URL(serverUrl);
  database.pathname = `/${name}`;
  const url = database.toString();

  const onServer = async (statement: string) => {
    const connection = await mysql.createConnection({ uri: server.toString() });
    try {
      await connection.query(statement);
    } finally {
      await connection.end();
    }
  };

  await onServer(`CREATE DATABASE \`${name}\``);
  process.env.DATABASE_URL = url;

  const envBefore = new Set(Object.keys(process.env));
  try {
    const { runMigrations } = await import("../migrate");
    await runMigrations();
  } catch (error) {
    await onServer(`DROP DATABASE IF EXISTS \`${name}\``);
    throw error;
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!envBefore.has(key)) delete process.env[key];
    }
  }

  return {
    drop: () => onServer(`DROP DATABASE IF EXISTS \`${name}\``),
  };
}
