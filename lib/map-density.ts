export type DensityPoint<T> = { id: string; x: number; y: number; score: number; item: T };

export function minimumMarkerDistance(zoom: number) {
  return clamp(110 - 10 * (zoom - 12), 48, 110);
}

export function thinMapPoints<T>(points: DensityPoint<T>[], zoom: number, selectedId: string | null) {
  const distance = minimumMarkerDistance(zoom);
  const sorted = [...points].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const selected = selectedId ? sorted.find((point) => point.id === selectedId) : undefined;
  const ordered = selected ? [selected, ...sorted.filter((point) => point.id !== selected.id)] : sorted;
  const accepted: DensityPoint<T>[] = [];
  const hidden: DensityPoint<T>[] = [];
  for (const point of ordered) {
    const canAccept = point.id === selectedId || accepted.every((item) => Math.hypot(point.x - item.x, point.y - item.y) >= distance);
    if (canAccept) accepted.push(point);
    else hidden.push(point);
  }
  return { accepted, hidden };
}

function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)); }
