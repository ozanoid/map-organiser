import type mapboxgl from "mapbox-gl";

/**
 * Lucide icon SVG element definitions for map markers.
 * Each entry is [elementType, attributes] — matches Lucide's internal format.
 * Only "path" and "circle" elements are used.
 */
type SvgElement = ["path", { d: string }] | ["circle", { cx: string; cy: string; r: string }];

const ICON_SVG_DATA: Record<string, SvgElement[]> = {
  utensils: [
    ["path", { d: "M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" }],
    ["path", { d: "M7 2v20" }],
    ["path", { d: "M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" }],
  ],
  coffee: [
    ["path", { d: "M10 2v2" }],
    ["path", { d: "M14 2v2" }],
    ["path", { d: "M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1" }],
    ["path", { d: "M6 2v2" }],
  ],
  wine: [
    ["path", { d: "M8 22h8" }],
    ["path", { d: "M7 10h10" }],
    ["path", { d: "M12 15v7" }],
    ["path", { d: "M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z" }],
  ],
  bed: [
    ["path", { d: "M2 4v16" }],
    ["path", { d: "M2 8h18a2 2 0 0 1 2 2v10" }],
    ["path", { d: "M2 17h20" }],
    ["path", { d: "M6 8v9" }],
  ],
  "shopping-bag": [
    ["path", { d: "M16 10a4 4 0 0 1-8 0" }],
    ["path", { d: "M3.103 6.034h17.794" }],
    ["path", { d: "M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z" }],
  ],
  landmark: [
    ["path", { d: "M10 18v-7" }],
    ["path", { d: "M11.12 2.198a2 2 0 0 1 1.76.006l7.866 3.847c.476.233.31.949-.22.949H3.474c-.53 0-.695-.716-.22-.949z" }],
    ["path", { d: "M14 18v-7" }],
    ["path", { d: "M18 18v-7" }],
    ["path", { d: "M3 22h18" }],
    ["path", { d: "M6 18v-7" }],
  ],
  trees: [
    ["path", { d: "M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z" }],
    ["path", { d: "M7 16v6" }],
    ["path", { d: "M13 19v3" }],
    ["path", { d: "M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5" }],
  ],
  waves: [
    ["path", { d: "M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" }],
    ["path", { d: "M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" }],
    ["path", { d: "M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" }],
  ],
  dumbbell: [
    ["path", { d: "M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z" }],
    ["path", { d: "m2.5 21.5 1.4-1.4" }],
    ["path", { d: "m20.1 3.9 1.4-1.4" }],
    ["path", { d: "M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z" }],
    ["path", { d: "m9.6 14.4 4.8-4.8" }],
  ],
  "heart-pulse": [
    ["path", { d: "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" }],
    ["path", { d: "M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" }],
  ],
  ticket: [
    ["path", { d: "M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" }],
    ["path", { d: "M13 5v2" }],
    ["path", { d: "M13 17v2" }],
    ["path", { d: "M13 11v2" }],
  ],
  "map-pin": [
    ["path", { d: "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" }],
    ["circle", { cx: "12", cy: "10", r: "3" }],
  ],
};

/** Default icon mapping for each default category name */
export const CATEGORY_DEFAULT_ICONS: Record<string, string> = {
  Restaurant: "utensils",
  Cafe: "coffee",
  "Bar & Nightlife": "wine",
  "Hotel & Accommodation": "bed",
  Shopping: "shopping-bag",
  "Museum & Culture": "landmark",
  "Park & Nature": "trees",
  Beach: "waves",
  "Gym & Sports": "dumbbell",
  "Health & Medical": "heart-pulse",
  Entertainment: "ticket",
  Other: "map-pin",
};

/** All available icons for the icon picker */
export const AVAILABLE_ICONS = Object.keys(ICON_SVG_DATA);

const MARKER_SIZE = 40;
const PIXEL_RATIO = 2;
const CANVAS_SIZE = MARKER_SIZE * PIXEL_RATIO;

/**
 * Render a category marker icon as a canvas ImageData.
 * Circle background with category color, white icon in center.
 */
function generateMarkerImage(
  iconName: string,
  color: string
): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d")!;

  const cx = CANVAS_SIZE / 2;
  const cy = CANVAS_SIZE / 2;
  const radius = (CANVAS_SIZE / 2) - 4; // leave room for stroke

  // White outer stroke
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 2, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  // Category color fill
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Draw icon in white
  const iconData = ICON_SVG_DATA[iconName] || ICON_SVG_DATA["map-pin"];
  const iconScale = (CANVAS_SIZE * 0.4) / 24; // Lucide icons are 24x24 viewBox
  const iconOffset = (CANVAS_SIZE - 24 * iconScale) / 2;

  ctx.save();
  ctx.translate(iconOffset, iconOffset);
  ctx.scale(iconScale, iconScale);
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "none";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const element of iconData) {
    if (element[0] === "path") {
      const path = new Path2D(element[1].d);
      ctx.stroke(path);
    } else if (element[0] === "circle") {
      const { cx: circCx, cy: circCy, r } = element[1];
      ctx.beginPath();
      ctx.arc(Number(circCx), Number(circCy), Number(r), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.restore();

  return ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
}

/**
 * Register all category marker icons on the Mapbox map.
 * Call this after map load and after style changes.
 */
export function registerCategoryIcons(
  map: mapboxgl.Map,
  categories: Array<{ icon: string; color: string }>
) {
  const registered = new Set<string>();

  for (const cat of categories) {
    const iconName = cat.icon || "map-pin";
    const imageId = `cat-${iconName}`;

    if (registered.has(imageId)) continue;
    if (map.hasImage(imageId)) continue;

    const imageData = generateMarkerImage(iconName, cat.color);
    map.addImage(imageId, imageData, { pixelRatio: PIXEL_RATIO });
    registered.add(imageId);
  }

  // Always register default fallback
  const defaultId = "cat-map-pin";
  if (!map.hasImage(defaultId)) {
    const imageData = generateMarkerImage("map-pin", "#6B7280");
    map.addImage(defaultId, imageData, { pixelRatio: PIXEL_RATIO });
  }
}
