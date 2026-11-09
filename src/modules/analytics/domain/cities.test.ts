import { describe, expect, it } from "vitest";

import {
  MOROCCO_CITIES,
  aggregateCityCounts,
  buildCityMapData,
  cityKeyForName,
  isCityFilterKey,
  normalizeCityText,
  rawCityNamesFor,
} from "./cities";

describe("city name matching", () => {
  it("ignores case, accents, spaces and punctuation", () => {
    expect(cityKeyForName("TETOUAN")).toBe("tetouan");
    expect(cityKeyForName("Tétouan")).toBe("tetouan");
    expect(cityKeyForName("  tetouan ")).toBe("tetouan");
    expect(cityKeyForName("El-Jadida")).toBe("eljadida");
    expect(cityKeyForName("Béni  Mellal")).toBe("benimellal");
  });

  it("maps known spelling variants", () => {
    expect(cityKeyForName("Fez")).toBe("fes");
    expect(cityKeyForName("Fès")).toBe("fes");
    expect(cityKeyForName("Tangier")).toBe("tanger");
    expect(cityKeyForName("Laayoune")).toBe("laayoune");
    expect(cityKeyForName("El Aaiun")).toBe("laayoune");
    expect(cityKeyForName("Casa")).toBe("casablanca");
  });

  it("returns null for unknown or empty values", () => {
    expect(cityKeyForName("Unknown town")).toBeNull();
    expect(cityKeyForName("")).toBeNull();
    expect(cityKeyForName("   ")).toBeNull();
  });

  it("never lets two cities claim the same normalised alias", () => {
    const owners = new Map<string, string>();
    for (const city of MOROCCO_CITIES) {
      for (const text of [city.name, city.key, ...city.aliases]) {
        const normalized = normalizeCityText(text);
        const previous = owners.get(normalized);
        expect(previous === undefined || previous === city.key, `${text} is claimed twice`).toBe(true);
        owners.set(normalized, city.key);
      }
    }
  });

  it("accepts only registered keys and the unmapped bucket as filters", () => {
    expect(isCityFilterKey("casablanca")).toBe(true);
    expect(isCityFilterKey("other")).toBe(true);
    expect(isCityFilterKey("Casablanca")).toBe(false);
    expect(isCityFilterKey("'; drop")).toBe(false);
  });
});

describe("city aggregation", () => {
  const raw = new Map<string, number>([
    ["Casablanca", 5],
    ["casablanca ", 2],
    ["Tanger", 3],
    ["Xyz", 1],
    ["", 1],
  ]);

  it("groups variants, counts unmapped values and reconciles to the total", () => {
    const result = aggregateCityCounts(raw, 12);
    expect(result.total).toBe(12);
    expect(result.unmappedCount).toBe(2);
    expect(result.mapped.find((city) => city.key === "casablanca")?.count).toBe(7);
    expect(result.reconciled).toBe(true);
    const mappedSum = result.mapped.reduce((sum, city) => sum + city.count, 0);
    expect(mappedSum + result.unmappedCount).toBe(12);
  });

  it("flags a mismatch between row totals and the exact total", () => {
    expect(aggregateCityCounts(raw, 13).reconciled).toBe(false);
  });

  it("ranks by count, shares rank on ties and breaks ties by name", () => {
    const result = aggregateCityCounts(new Map([["Rabat", 2], ["Fes", 2], ["Agadir", 1]]), 5);
    expect(result.mapped.map((city) => [city.name, city.rank])).toEqual([
      ["Fès", 1],
      ["Rabat", 1],
      ["Agadir", 3],
    ]);
  });

  it("drops cities with no orders from the ranking", () => {
    const result = aggregateCityCounts(new Map([["Rabat", 0], ["Agadir", 2]]), 2);
    expect(result.mapped.map((city) => city.name)).toEqual(["Agadir"]);
  });

  it("returns raw names per filter key so the Orders filter matches the map exactly", () => {
    const names = ["Casablanca", "casablanca ", "Xyz", ""];
    expect(rawCityNamesFor(names, "casablanca")).toEqual(["Casablanca", "casablanca "]);
    expect(rawCityNamesFor(names, "other")).toEqual(["Xyz", ""]);
  });

  it("builds map markers inside the view box with radii that grow with count", () => {
    const data = buildCityMapData(aggregateCityCounts(raw, 12));
    expect(data.markers.length).toBe(2);
    const [first, second] = data.markers;
    expect(first.radius).toBeGreaterThan(second.radius);
    expect(first.labelled).toBe(true);
    for (const marker of data.markers) {
      expect(marker.x).toBeGreaterThanOrEqual(0);
      expect(marker.y).toBeGreaterThanOrEqual(0);
    }
    expect(data.grid.startsWith("M")).toBe(true);
  });
});
