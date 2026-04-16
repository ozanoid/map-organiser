import type { Place } from "@/lib/types";

interface PlannedDay {
  dayNumber: number;
  places: Place[];
}

// Category time-slot priorities (lower = earlier in day)
const CATEGORY_TIME_ORDER: Record<string, number> = {
  Cafe: 0,
  Beach: 1,
  "Park & Nature": 1,
  "Museum & Culture": 2,
  Shopping: 2,
  "Gym & Sports": 2,
  "Health & Medical": 2,
  Entertainment: 3,
  "Hotel & Accommodation": 3,
  Restaurant: 4,
  "Bar & Nightlife": 5,
  Other: 3,
};

function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * K-Means clustering of places into k groups by geographic proximity.
 * Returns array of k groups (arrays of place indices).
 */
function kMeansClusters(places: Place[], k: number, iterations = 8): number[][] {
  if (places.length <= k) {
    return places.map((_, i) => [i]);
  }

  // Initialize centroids: pick k places spread out
  const centroids: { lat: number; lng: number }[] = [];
  const usedIndices = new Set<number>();

  // First centroid: random
  const first = 0;
  centroids.push({ lat: places[first].location.lat, lng: places[first].location.lng });
  usedIndices.add(first);

  // K-means++ init: pick farthest points
  while (centroids.length < k) {
    let maxDist = -1;
    let maxIdx = 0;
    for (let i = 0; i < places.length; i++) {
      if (usedIndices.has(i)) continue;
      const minDist = Math.min(
        ...centroids.map((c) =>
          haversineDistance(places[i].location.lat, places[i].location.lng, c.lat, c.lng)
        )
      );
      if (minDist > maxDist) {
        maxDist = minDist;
        maxIdx = i;
      }
    }
    centroids.push({ lat: places[maxIdx].location.lat, lng: places[maxIdx].location.lng });
    usedIndices.add(maxIdx);
  }

  let assignments = new Array(places.length).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    // Assign each place to nearest centroid
    for (let i = 0; i < places.length; i++) {
      let minDist = Infinity;
      let minCluster = 0;
      for (let c = 0; c < centroids.length; c++) {
        const dist = haversineDistance(
          places[i].location.lat, places[i].location.lng,
          centroids[c].lat, centroids[c].lng
        );
        if (dist < minDist) {
          minDist = dist;
          minCluster = c;
        }
      }
      assignments[i] = minCluster;
    }

    // Update centroids
    for (let c = 0; c < centroids.length; c++) {
      const members = places.filter((_, i) => assignments[i] === c);
      if (members.length > 0) {
        centroids[c] = {
          lat: members.reduce((s, p) => s + p.location.lat, 0) / members.length,
          lng: members.reduce((s, p) => s + p.location.lng, 0) / members.length,
        };
      }
    }
  }

  // Build groups
  const groups: number[][] = Array.from({ length: k }, () => []);
  assignments.forEach((cluster, idx) => {
    groups[cluster].push(idx);
  });

  // Remove empty groups and redistribute
  return groups.filter((g) => g.length > 0);
}

/**
 * Sort places within a day: category time-order first, then nearest-neighbor
 * for same-priority places.
 */
function sortDayPlaces(places: Place[]): Place[] {
  if (places.length <= 1) return places;

  // Sort by category time slot
  const sorted = [...places].sort((a, b) => {
    const orderA = CATEGORY_TIME_ORDER[a.category?.name || "Other"] ?? 3;
    const orderB = CATEGORY_TIME_ORDER[b.category?.name || "Other"] ?? 3;
    return orderA - orderB;
  });

  // Within same time-slot groups, apply nearest-neighbor
  const result: Place[] = [];
  let current = sorted[0];
  const remaining = new Set(sorted.map((_, i) => i));

  // Start with earliest time-slot place
  result.push(current);
  remaining.delete(0);

  while (remaining.size > 0) {
    let nearestIdx = -1;
    let nearestDist = Infinity;

    for (const idx of remaining) {
      const dist = haversineDistance(
        current.location.lat, current.location.lng,
        sorted[idx].location.lat, sorted[idx].location.lng
      );
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = idx;
      }
    }

    if (nearestIdx >= 0) {
      current = sorted[nearestIdx];
      result.push(current);
      remaining.delete(nearestIdx);
    }
  }

  return result;
}

/**
 * Auto-plan: distribute places across days using geographic clustering
 * and category-based time ordering.
 */
export function autoPlanTrip(places: Place[], dayCount: number): PlannedDay[] {
  if (places.length === 0) {
    return Array.from({ length: dayCount }, (_, i) => ({ dayNumber: i + 1, places: [] }));
  }

  if (dayCount <= 0) dayCount = 1;

  // Cluster places geographically
  const clusters = kMeansClusters(places, dayCount);

  // Map clusters to days, sorting each day's places
  const days: PlannedDay[] = clusters.map((indices, i) => ({
    dayNumber: i + 1,
    places: sortDayPlaces(indices.map((idx) => places[idx])),
  }));

  // Fill remaining empty days if clusters < dayCount
  while (days.length < dayCount) {
    days.push({ dayNumber: days.length + 1, places: [] });
  }

  return days;
}
