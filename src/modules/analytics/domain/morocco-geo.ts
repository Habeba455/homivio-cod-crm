/**
 * Map projection and Morocco border for the city map.
 * The border ring comes from the Morocco.json boundary file supplied for this project (one Polygon, WGS84
 * longitude and latitude). The dataset's extent includes the southern territory it lists as Morocco.
 * Markers use approximate city coordinates. Points are [longitude, latitude].
 */
export const MOROCCO_OUTLINE: ReadonlyArray<readonly [number, number]> = [
  [-2.186, 35.192],
  [-1.802, 34.534],
  [-1.758, 33.916],
  [-1.384, 32.852],
  [-1.121, 32.649],
  [-1.340, 32.269],
  [-2.571, 32.110],
  [-2.900, 31.906],
  [-3.043, 31.747],
  [-3.669, 31.653],
  [-3.713, 30.921],
  [-4.889, 30.515],
  [-5.262, 30.022],
  [-6.053, 29.745],
  [-7.042, 29.602],
  [-8.690, 28.874],
  [-8.701, 25.849],
  [-11.986, 25.938],
  [-11.964, 23.383],
  [-12.876, 23.282],
  [-13.162, 22.766],
  [-12.942, 21.351],
  [-16.886, 21.361],
  [-17.084, 21.013],
  [-17.007, 20.807],
  [-17.117, 20.920],
  [-17.093, 21.048],
  [-17.054, 21.165],
  [-16.941, 21.856],
  [-16.732, 22.264],
  [-16.540, 22.325],
  [-16.397, 22.568],
  [-16.144, 23.201],
  [-15.864, 23.665],
  [-15.557, 24.107],
  [-15.194, 24.477],
  [-14.941, 24.577],
  [-14.810, 25.026],
  [-14.843, 25.205],
  [-14.755, 25.483],
  [-14.502, 25.968],
  [-14.491, 26.146],
  [-14.172, 26.382],
  [-13.557, 26.706],
  [-12.975, 27.907],
  [-12.261, 28.024],
  [-11.294, 28.488],
  [-11.096, 28.719],
  [-10.316, 29.229],
  [-9.899, 29.793],
  [-9.580, 30.373],
  [-9.679, 30.543],
  [-9.866, 30.657],
  [-9.888, 30.732],
  [-9.800, 30.921],
  [-9.844, 31.410],
  [-9.690, 31.616],
  [-9.492, 31.924],
  [-9.272, 32.148],
  [-9.283, 32.575],
  [-8.657, 33.119],
  [-8.624, 33.211],
  [-8.514, 33.303],
  [-8.328, 33.349],
  [-8.053, 33.459],
  [-7.690, 33.605],
  [-7.031, 33.925],
  [-6.768, 34.098],
  [-6.537, 34.516],
  [-6.240, 35.012],
  [-6.086, 35.452],
  [-5.977, 35.684],
  [-5.966, 35.782],
  [-5.856, 35.791],
  [-5.658, 35.845],
  [-5.383, 35.898],
  [-5.306, 35.818],
  [-5.109, 35.470],
  [-4.603, 35.147],
  [-3.911, 35.264],
  [-3.768, 35.201],
  [-3.702, 35.299],
  [-3.494, 35.201],
  [-3.241, 35.201],
  [-2.977, 35.389],
  [-2.845, 35.093],
  [-2.692, 35.102],
  [-2.582, 35.084],
  [-2.428, 35.120],
  [-2.252, 35.111],
  [-2.186, 35.192],
];

const MIN_LON = -17.2;
const MAX_LON = -1.0;
const MIN_LAT = 20.7;
const MAX_LAT = 36.0;
/** Scales longitude by the cosine of a reference latitude so distances look roughly right. */
const COS_REFERENCE = Math.cos((29 * Math.PI) / 180);

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export const MAP_VIEW_BOX = `0 0 ${round((MAX_LON - MIN_LON) * COS_REFERENCE, 2)} ${round(MAX_LAT - MIN_LAT, 2)}`;

export function projectToMap(lon: number, lat: number): { x: number; y: number } {
  return { x: round((lon - MIN_LON) * COS_REFERENCE, 3), y: round(MAX_LAT - lat, 3) };
}

/** Empty string when no border ring is configured. */
export function outlinePath(): string {
  if (MOROCCO_OUTLINE.length === 0) return "";
  const points = MOROCCO_OUTLINE.map(([lon, lat]) => {
    const p = projectToMap(lon, lat);
    return `${p.x} ${p.y}`;
  });
  return `M${points.join(" L")} Z`;
}

/** A light latitude and longitude grid every two degrees, inside the map bounds. */
export function graticulePath(): string {
  const segments: string[] = [];
  for (let lon = Math.ceil(MIN_LON / 2) * 2; lon <= MAX_LON; lon += 2) {
    const a = projectToMap(lon, MIN_LAT);
    const b = projectToMap(lon, MAX_LAT);
    segments.push(`M${a.x} ${a.y} L${b.x} ${b.y}`);
  }
  for (let lat = Math.ceil(MIN_LAT / 2) * 2; lat <= MAX_LAT; lat += 2) {
    const a = projectToMap(MIN_LON, lat);
    const b = projectToMap(MAX_LON, lat);
    segments.push(`M${a.x} ${a.y} L${b.x} ${b.y}`);
  }
  return segments.join(" ");
}
