/** One colour per day — the day badge, its timeline rail and its route line
 *  on the map share it. */
const DAY_COLORS = ["#3B82F6", "#F97316", "#8B5CF6", "#22C55E", "#EC4899", "#06B6D4", "#F59E0B"];

export function dayColor(dayNumber: number): string {
  return DAY_COLORS[(dayNumber - 1) % DAY_COLORS.length];
}
