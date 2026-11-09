/**
 * Shipping-city registry, spelling normalisation and per-city aggregation. Pure, so the rules are tested in one place.
 * Coordinates are approximate city-centre points from general reference data. They have not been checked against a
 * geocoder or survey, so spot-check them before relying on the map's exact positions.
 */
import { graticulePath, MAP_VIEW_BOX, outlinePath, projectToMap } from "./morocco-geo";

export const OTHER_CITY_KEY = "other";

export type CityDefinition = {
  /** Stable lowercase key used in URLs. */
  key: string;
  name: string;
  lat: number;
  lon: number;
  /** Other spellings seen in shipping data. Matching ignores case, accents, spaces, hyphens and apostrophes. */
  aliases: readonly string[];
};

export const MOROCCO_CITIES: readonly CityDefinition[] = [
  { key: "casablanca", name: "Casablanca", lat: 33.5731, lon: -7.5898, aliases: ["Casa", "Casa Blanca", "Dar El Beida"] },
  { key: "rabat", name: "Rabat", lat: 34.0209, lon: -6.8416, aliases: [] },
  { key: "sale", name: "Salé", lat: 34.0531, lon: -6.7985, aliases: ["Sale"] },
  { key: "temara", name: "Témara", lat: 33.9287, lon: -6.9106, aliases: ["Temara", "Temera"] },
  { key: "kenitra", name: "Kénitra", lat: 34.261, lon: -6.5802, aliases: ["Kenira"] },
  { key: "fes", name: "Fès", lat: 34.0181, lon: -5.0078, aliases: ["Fes", "Fez"] },
  { key: "meknes", name: "Meknès", lat: 33.8935, lon: -5.5473, aliases: ["Meknes"] },
  { key: "marrakech", name: "Marrakech", lat: 31.6295, lon: -7.9811, aliases: ["Marrakesh", "Marakech"] },
  { key: "tanger", name: "Tanger", lat: 35.7595, lon: -5.834, aliases: ["Tangier", "Tanja"] },
  { key: "tetouan", name: "Tétouan", lat: 35.5785, lon: -5.3684, aliases: ["Tetouan", "Tetuan"] },
  { key: "agadir", name: "Agadir", lat: 30.4278, lon: -9.5981, aliases: [] },
  { key: "oujda", name: "Oujda", lat: 34.6814, lon: -1.9086, aliases: ["Oujda Angad"] },
  { key: "mohammedia", name: "Mohammédia", lat: 33.6866, lon: -7.383, aliases: ["Mohammedia", "Mohamedia"] },
  { key: "eljadida", name: "El Jadida", lat: 33.2316, lon: -8.5007, aliases: ["Jadida"] },
  { key: "nador", name: "Nador", lat: 35.1681, lon: -2.9335, aliases: [] },
  { key: "benimellal", name: "Béni Mellal", lat: 32.3373, lon: -6.3498, aliases: ["Beni Mellal", "Bni Mellal"] },
  { key: "safi", name: "Safi", lat: 32.2994, lon: -9.2372, aliases: [] },
  { key: "essaouira", name: "Essaouira", lat: 31.5085, lon: -9.7595, aliases: ["Mogador"] },
  { key: "laayoune", name: "Laâyoune", lat: 27.1536, lon: -13.2033, aliases: ["Laayoune", "El Aaiun"] },
  { key: "dakhla", name: "Dakhla", lat: 23.6848, lon: -15.9579, aliases: ["Ad Dakhla"] },
  { key: "settat", name: "Settat", lat: 33.001, lon: -7.6166, aliases: [] },
  { key: "khouribga", name: "Khouribga", lat: 32.8811, lon: -6.9063, aliases: [] },
  { key: "ouarzazate", name: "Ouarzazate", lat: 30.9189, lon: -6.8934, aliases: [] },
  { key: "errachidia", name: "Errachidia", lat: 31.9314, lon: -4.4242, aliases: [] },
  { key: "taza", name: "Taza", lat: 34.21, lon: -4.01, aliases: [] },
  { key: "larache", name: "Larache", lat: 35.1932, lon: -6.1561, aliases: [] },
  { key: "alhoceima", name: "Al Hoceïma", lat: 35.2472, lon: -3.932, aliases: ["Al Hoceima", "Hoceima"] },
  { key: "berrechid", name: "Berrechid", lat: 33.265, lon: -7.587, aliases: [] },
  { key: "tiznit", name: "Tiznit", lat: 29.6974, lon: -9.7316, aliases: [] },
  { key: "guelmim", name: "Guelmim", lat: 28.987, lon: -10.0574, aliases: [] },
];

/** Lowercase letters and digits only, with accents removed. Used for matching, never for display. */
export function normalizeCityText(input: string): string {
  return input.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const CITY_BY_KEY = new Map<string, CityDefinition>(MOROCCO_CITIES.map((city) => [city.key, city]));

const KEY_BY_ALIAS = new Map<string, string>();
for (const city of MOROCCO_CITIES) {
  for (const text of [city.name, city.key, ...city.aliases]) {
    KEY_BY_ALIAS.set(normalizeCityText(text), city.key);
  }
}

/** The registry key for a raw shipping-city value, or null when the value is not a known city. */
export function cityKeyForName(raw: string): string | null {
  const normalized = normalizeCityText(raw);
  if (normalized === "") return null;
  return KEY_BY_ALIAS.get(normalized) ?? null;
}

export function cityByKey(key: string): CityDefinition | null {
  return CITY_BY_KEY.get(key) ?? null;
}

/** Keys accepted by the Orders city filter: every registered city, plus the unmapped bucket. */
export function isCityFilterKey(value: string): boolean {
  return value === OTHER_CITY_KEY || CITY_BY_KEY.has(value);
}

export function cityFilterLabel(key: string): string {
  return cityByKey(key)?.name ?? "Other or unrecognised";
}

/** Raw values that belong to one city key. The unmapped bucket returns every value no city claims. */
export function rawCityNamesFor(rawNames: Iterable<string>, key: string): string[] {
  const names: string[] = [];
  for (const raw of rawNames) {
    if ((cityKeyForName(raw) ?? OTHER_CITY_KEY) === key) names.push(raw);
  }
  return names;
}

export type CityCount = { key: string; name: string; count: number; rank: number };

export type CityAggregate = {
  /** Every imported order, from the exact total query. */
  total: number;
  /** Mapped cities with at least one order, ranked. Ties share a rank ("1, 1, 3"). */
  mapped: CityCount[];
  unmappedCount: number;
  /** False when the row totals and the exact total disagree, for example because orders changed mid-read. */
  reconciled: boolean;
};

export function aggregateCityCounts(rawCounts: ReadonlyMap<string, number>, expectedTotal: number): CityAggregate {
  const byKey = new Map<string, number>();
  let unmappedCount = 0;
  let rowSum = 0;

  for (const [raw, count] of rawCounts) {
    rowSum += count;
    const key = cityKeyForName(raw);
    if (key === null) {
      unmappedCount += count;
    } else {
      byKey.set(key, (byKey.get(key) ?? 0) + count);
    }
  }

  const sorted = [...byKey]
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ key, name: CITY_BY_KEY.get(key)?.name ?? key, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "en"));

  let previousCount = -1;
  let rank = 0;
  const mapped: CityCount[] = sorted.map((item, index) => {
    if (item.count !== previousCount) {
      rank = index + 1;
      previousCount = item.count;
    }
    return { ...item, rank };
  });

  const mappedSum = mapped.reduce((sum, city) => sum + city.count, 0);
  return {
    total: expectedTotal,
    mapped,
    unmappedCount,
    reconciled: rowSum === expectedTotal && mappedSum + unmappedCount === expectedTotal,
  };
}

export type MapMarker = CityCount & { x: number; y: number; radius: number; labelled: boolean };

export type CityMapData = {
  viewBox: string;
  /** Empty when no border is configured. */
  outline: string;
  /** Latitude and longitude grid lines. */
  grid: string;
  markers: MapMarker[];
  ranked: CityCount[];
  unmappedCount: number;
  total: number;
  reconciled: boolean;
};

/** Marker radius scales with the square root of the count, so area tracks volume. Labels go on the top three. */
export function buildCityMapData(aggregate: CityAggregate): CityMapData {
  const largest = aggregate.mapped[0]?.count ?? 1;
  const markers: MapMarker[] = aggregate.mapped.map((city) => {
    const definition = CITY_BY_KEY.get(city.key);
    const point = definition ? projectToMap(definition.lon, definition.lat) : { x: 0, y: 0 };
    return {
      ...city,
      x: point.x,
      y: point.y,
      radius: Math.round((0.12 + 0.26 * Math.sqrt(city.count / largest)) * 1000) / 1000,
      labelled: city.rank <= 3,
    };
  });

  return {
    viewBox: MAP_VIEW_BOX,
    outline: outlinePath(),
    grid: graticulePath(),
    markers,
    ranked: aggregate.mapped,
    unmappedCount: aggregate.unmappedCount,
    total: aggregate.total,
    reconciled: aggregate.reconciled,
  };
}
