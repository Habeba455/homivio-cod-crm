"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";

import type { CityMapData } from "@/modules/analytics/domain/cities";

/**
 * Morocco map of imported orders by shipping city, paired with a ranked list. Hovering or focusing a city
 * highlights its marker and its list row together. Each city links to Orders filtered to that city.
 * Only city names and counts are received here; no customer data reaches the browser.
 */
export function CityMap({ data }: { data: CityMapData }) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const topFive = data.ranked.filter((city) => city.rank <= 5);
  const mappedTotal = data.ranked.reduce((sum, city) => sum + city.count, 0);

  return (
    <div className="ov-map-body">
      <div className="ov-map-canvas">
        <svg viewBox={data.viewBox} className="ov-map-svg" role="img" aria-labelledby="ov-map-title">
          <title id="ov-map-title">Morocco: imported orders by shipping city</title>
          <path d={data.grid} className="ov-grid-lines" />
          {data.outline !== "" ? <path d={data.outline} className="ov-outline" /> : null}
          {data.markers.map((marker, index) => (
            <a
              key={marker.key}
              href={`/admin?city=${marker.key}`}
              aria-label={`${marker.name}: ${marker.count} orders. Open these orders.`}
              className={`ov-marker${activeKey === marker.key ? " is-active" : ""}`}
              style={{ "--i": index } as CSSProperties}
              onMouseEnter={() => setActiveKey(marker.key)}
              onMouseLeave={() => setActiveKey(null)}
              onFocus={() => setActiveKey(marker.key)}
              onBlur={() => setActiveKey(null)}
            >
              <circle cx={marker.x} cy={marker.y} r={marker.radius} />
              {marker.labelled ? (
                <text x={marker.x + marker.radius + 0.05} y={marker.y + 0.12}>
                  {marker.name}
                </text>
              ) : null}
            </a>
          ))}
        </svg>
      </div>

      <div className="ov-map-side">
        {topFive.length === 0 ? (
          <p className="ov-empty">No imported orders have a mapped city yet.</p>
        ) : (
          <ol className="ov-rank" aria-label="Top cities by imported orders">
            {topFive.map((city) => (
              <li key={city.key}>
                <Link
                  href={`/admin?city=${city.key}`}
                  className={`ov-rank-row${activeKey === city.key ? " is-active" : ""}`}
                  onMouseEnter={() => setActiveKey(city.key)}
                  onMouseLeave={() => setActiveKey(null)}
                  onFocus={() => setActiveKey(city.key)}
                  onBlur={() => setActiveKey(null)}
                >
                  <span className="ov-rank-no">{city.rank}</span>
                  <span className="ov-rank-name">{city.name}</span>
                  <span className="ov-rank-count">{city.count.toLocaleString("en-US")}</span>
                </Link>
              </li>
            ))}
          </ol>
        )}

        <Link href="/admin?city=other" className="ov-rank-row ov-rank-other">
          <span className="ov-rank-no" aria-hidden="true">–</span>
          <span className="ov-rank-name">Other or unrecognised</span>
          <span className="ov-rank-count">{data.unmappedCount.toLocaleString("en-US")}</span>
        </Link>

        <p className="ov-map-foot">
          Dots sit at approximate city positions. No border is drawn.
        </p>
        <p className="ov-map-foot">
          {mappedTotal.toLocaleString("en-US")} mapped + {data.unmappedCount.toLocaleString("en-US")} other ={" "}
          {data.total.toLocaleString("en-US")} imported
        </p>
        {!data.reconciled ? (
          <p role="status" className="ov-note">
            Orders changed while this loaded. Refresh to reconcile the counts.
          </p>
        ) : null}
      </div>
    </div>
  );
}
