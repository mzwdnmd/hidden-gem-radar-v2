import type { BrandBlacklistEntry, Restaurant, V4RestaurantLabel } from "@/lib/restaurant-types";
import { extractCanonicalBrand } from "@/lib/brand-normalizer";

export const V4_STORAGE_KEY = "hidden-gem-v4-state";
export const V3_LABEL_STORAGE_KEY = "hidden-gem-v3-labels";

export type V4State = {
  version: 1;
  restaurantLabels: Record<string, V4RestaurantLabel>;
  brandBlacklist: BrandBlacklistEntry[];
  entertainmentWhitelist: string[];
  settings: { showFiltered: boolean; densityEnabled: boolean };
};

export function emptyV4State(): V4State {
  return { version: 1, restaurantLabels: {}, brandBlacklist: [], entertainmentWhitelist: [], settings: { showFiltered: false, densityEnabled: true } };
}

export function loadV4State(): V4State {
  if (typeof window === "undefined") return emptyV4State();
  const stored = parseState(window.localStorage.getItem(V4_STORAGE_KEY));
  if (stored) return stored;
  const legacy = parseLegacy(window.localStorage.getItem(V3_LABEL_STORAGE_KEY));
  const migrated = legacyToV4(legacy);
  if (Object.keys(migrated.restaurantLabels).length || migrated.brandBlacklist.length) saveV4State(migrated);
  return migrated;
}

export function saveV4State(state: V4State) {
  if (typeof window !== "undefined") window.localStorage.setItem(V4_STORAGE_KEY, JSON.stringify(state));
}

function parseState(value: string | null): V4State | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<V4State>;
    if (parsed.version !== 1 || !parsed.restaurantLabels || !Array.isArray(parsed.brandBlacklist)) return null;
    return { ...emptyV4State(), ...parsed, settings: { ...emptyV4State().settings, ...parsed.settings } } as V4State;
  } catch { return null; }
}

function parseLegacy(value: string | null): Record<string, { restaurant: Restaurant; labels: string[]; reasons: string[]; note: string; updatedAt: string }> {
  if (!value) return {};
  try { return JSON.parse(value) as Record<string, { restaurant: Restaurant; labels: string[]; reasons: string[]; note: string; updatedAt: string }>; }
  catch { return {}; }
}

function legacyToV4(legacy: Record<string, { restaurant: Restaurant; labels: string[]; reasons: string[]; note: string; updatedAt: string }>): V4State {
  const state = emptyV4State();
  for (const [id, item] of Object.entries(legacy)) {
    const createdAt = item.updatedAt || new Date().toISOString();
    const canonicalBrand = item.labels.includes("chain") ? extractCanonicalBrand(item.restaurant.name) : null;
    state.restaurantLabels[id] = {
      restaurantId: id, provider: "amap", originalName: item.restaurant.name, normalizedName: item.restaurant.name,
      canonicalBrand, labels: item.labels.filter((label): label is V4RestaurantLabel["labels"][number] => ["want", "blacklist", "chain", "liked", "average", "not_interested"].includes(label)),
      reasons: item.reasons, note: item.note, restaurantSnapshot: item.restaurant, createdAt, updatedAt: createdAt,
    };
    if (canonicalBrand && !state.brandBlacklist.some((entry) => entry.canonicalName === canonicalBrand)) {
      state.brandBlacklist.push({
        id: `brand-${canonicalBrand}-${id}`, canonicalName: canonicalBrand, aliases: [], sourceRestaurantIds: [id],
        sourceNames: [item.restaurant.name], createdBy: "user", createdAt, updatedAt: createdAt,
      });
    }
  }
  return state;
}
