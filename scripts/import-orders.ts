/**
 * Operator-run import of sample_orders.json (architecture §5.3). Never deployed. Never imported by the app.
 *
 * Dry run (default, writes nothing):
 *   npx tsx scripts/import-orders.ts /path/to/sample_orders.json
 *
 * Import (writes to the project in NEXT_PUBLIC_SUPABASE_URL; run only after approval):
 *   npx tsx scripts/import-orders.ts /path/to/sample_orders.json --apply
 *
 * The key is read from SUPABASE_SECRET_KEY in .env.local (legacy SUPABASE_SERVICE_ROLE_KEY is an optional fallback).
 * It is never printed, logged or shipped. Customer data is never printed.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { createAdminClient, resolveAdminKey } from "../src/lib/supabase/admin-client";
import { EXPECTED_FILE_SHA256, validateSourceFile } from "../src/modules/orders/source-import";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  // Node reads .env.local without printing values. Missing file is fine for a dry run.
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No local env file. --apply will report the missing variables below.
  }

  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const filePath = args.find((arg) => !arg.startsWith("--"));
  if (filePath === undefined) {
    fail("Usage: npx tsx scripts/import-orders.ts <path-to-sample_orders.json> [--apply]");
  }

  const bytes = await readFile(filePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  let json: unknown;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("The file is not valid JSON. Nothing was written.");
  }

  const validation = validateSourceFile(json);
  if (!validation.ok) {
    console.error(`Validation failed with ${validation.issues.length} problem(s). Nothing was written:`);
    for (const issue of validation.issues) {
      console.error(`  ${issue.path}: ${issue.message}`);
    }
    process.exit(1);
  }

  const { summary } = validation;
  console.log(`file: ${basename(filePath)}`);
  console.log(`sha256: ${sha256}`);
  console.log(`matches verified checksum: ${sha256 === EXPECTED_FILE_SHA256 ? "yes" : "no"}`);
  console.log(`orders: ${summary.orderCount} (pipeline ${summary.pipelineCount}, historical ${summary.historicalCount})`);
  console.log(`customers: ${summary.customerCount}, order items: ${summary.itemCount}`);

  if (!apply) {
    console.log("Dry run complete. Nothing was written. Re-run with --apply to import.");
    return;
  }

  if (sha256 !== EXPECTED_FILE_SHA256) {
    fail("Refusing to import: the checksum is not the verified sample_orders.json. Nothing was written.");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (url === "") {
    fail("Set NEXT_PUBLIC_SUPABASE_URL in .env.local.");
  }
  const resolved = resolveAdminKey(process.env);
  if (!resolved.ok) {
    fail(`Cannot import: ${resolved.problem}. No value is printed. Nothing was written.`);
  }

  console.log(`target host: ${new URL(url).host}`);
  console.log(`key type: ${resolved.kind === "secret" ? "secret key" : "legacy service_role key"} (value not printed)`);
  const client = createAdminClient(url, resolved);

  const { data, error } = await client.rpc("import_source_orders", {
    p_file_name: basename(filePath),
    p_file_sha256: sha256,
    p_orders: validation.rawOrders,
  });

  if (error) {
    fail(`Import failed and was rolled back: ${error.message}`);
  }
  console.log("Result:", JSON.stringify(data));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unexpected error";
  fail(`Import stopped: ${message}`);
});
