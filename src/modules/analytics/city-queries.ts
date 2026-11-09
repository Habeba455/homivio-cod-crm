import "server-only";

import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { aggregateCityCounts, rawCityNamesFor, type CityAggregate } from "./domain/cities";

/**
 * City reads for the Overview map and the Orders city filter. They run with the admin's session, so RLS applies.
 * Only shipping_city is read. Rows are aggregated here, and only city names and counts leave this module.
 * Nothing is cached: the counts change as orders are imported.
 */

const PAGE_SIZE = 1000;
/** Above this many imported orders, the map shows a notice rather than reading every row. */
export const MAX_CITY_ROWS = 50000;

const cityRowSchema = z.object({ shipping_city: z.string().nullable() });

type RawCityLoad = { ok: true; counts: Map<string, number>; expectedTotal: number } | { ok: false };

async function loadRawCityCounts(): Promise<RawCityLoad> {
  const supabase = await createSupabaseServerClient();

  const exact = await supabase.from("orders").select("id", { count: "exact", head: true });
  if (exact.error !== null || exact.count === null) {
    console.error("city total failed", exact.error?.code);
    return { ok: false };
  }
  if (exact.count > MAX_CITY_ROWS) {
    console.error("city counts skipped: too many orders", exact.count);
    return { ok: false };
  }

  const counts = new Map<string, number>();
  let offset = 0;
  let seen = 0;
  while (seen < exact.count) {
    // Ordered by id so pages do not overlap or skip rows.
    const { data, error } = await supabase
      .from("orders")
      .select("shipping_city")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      console.error("city page failed", error.code);
      return { ok: false };
    }
    const parsed = z.array(cityRowSchema).safeParse(data);
    if (!parsed.success) {
      console.error("city page rejected: unexpected row shape");
      return { ok: false };
    }
    for (const row of parsed.data) {
      const raw = row.shipping_city ?? "";
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    }
    if (parsed.data.length === 0) break;
    seen += parsed.data.length;
    offset += PAGE_SIZE;
    if (parsed.data.length < PAGE_SIZE) break;
  }

  return { ok: true, counts, expectedTotal: exact.count };
}

/** The Overview map's data: ranked mapped cities, the unmapped count and a reconciliation flag. */
export async function loadOrderCityAggregate(): Promise<{ ok: true; aggregate: CityAggregate } | { ok: false }> {
  const loaded = await loadRawCityCounts();
  if (!loaded.ok) return { ok: false };
  return { ok: true, aggregate: aggregateCityCounts(loaded.counts, loaded.expectedTotal) };
}

/**
 * The raw shipping-city values that belong to one city key, for the Orders filter. Null when the read fails.
 * Values stay on the server and are passed straight into the order query.
 */
export async function loadRawCityNamesForCity(key: string): Promise<string[] | null> {
  const loaded = await loadRawCityCounts();
  if (!loaded.ok) return null;
  return rawCityNamesFor(loaded.counts.keys(), key);
}
