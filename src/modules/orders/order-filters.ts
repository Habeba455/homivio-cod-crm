import { isCityFilterKey } from "@/modules/analytics/domain/cities";

import { SOURCE_STATUSES } from "./domain/status";

/**
 * Pure parsing of the Admin orders query string. Invalid values fall back to safe defaults.
 */
export const ORDER_STATUS_FILTERS = ["all", ...SOURCE_STATUSES] as const;
export type OrderStatusFilter = (typeof ORDER_STATUS_FILTERS)[number];

export type OrderListFilters = {
  q: string;
  status: OrderStatusFilter;
  /** A registered city key, or "other" for unmapped values. Empty when no city filter applies. */
  city: string;
};

const MAX_QUERY_LENGTH = 100;

/**
 * Keeps letters, digits, spaces and '-' only. Commas, parentheses, dots, plus signs and wildcards could change
 * the PostgREST filter syntax or its URL encoding, so they are removed. Phone searches still match on digits.
 */
export function sanitizeSearchText(input: string): string {
  return input
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseOrderFilters(
  params: Readonly<Record<string, string | string[] | undefined>>,
): OrderListFilters {
  const rawStatus = firstValue(params.status) ?? "all";
  const status = (ORDER_STATUS_FILTERS as readonly string[]).includes(rawStatus)
    ? (rawStatus as OrderStatusFilter)
    : "all";

  const rawCity = firstValue(params.city) ?? "";
  const city = isCityFilterKey(rawCity) ? rawCity : "";

  return {
    q: sanitizeSearchText(firstValue(params.q) ?? ""),
    status,
    city,
  };
}
