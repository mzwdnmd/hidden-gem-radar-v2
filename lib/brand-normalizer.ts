import type { BrandBlacklistEntry } from "@/lib/restaurant-types";

const BRANCH_SUFFIX = /(?:总店|分店|旗舰店|直营店|加盟店|概念店)$/u;
const BRANCH_PARENTHESIS = /\([^)]*(?:店|分店|总店|旗舰店|直营店|加盟店)[^)]*\)$/u;
const COMMON_BRANCH_SUFFIX = /(?:万达|广场|大学城|商场|购物中心|路|街)店$/u;

export function normalizeRestaurantName(name: string) {
  return name
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/gu, "")
    .replace(/[·•・,，。.!！、/\\_-]+/gu, "")
    .trim();
}

export function extractCanonicalBrand(name: string) {
  let normalized = normalizeRestaurantName(name);
  if (!normalized) return "";
  if (BRANCH_PARENTHESIS.test(normalized)) normalized = normalized.replace(/\([^)]*\)$/u, "");
  normalized = normalized.replace(BRANCH_SUFFIX, "");
  normalized = normalized.replace(COMMON_BRANCH_SUFFIX, "");
  return normalized;
}

export function isSameBrand(name: string, entry: BrandBlacklistEntry) {
  const normalized = extractCanonicalBrand(name);
  if (!normalized) return false;
  const names = [entry.canonicalName, ...entry.aliases]
    .map(extractCanonicalBrand)
    .filter(Boolean);
  return names.includes(normalized);
}

export function makeBrandEntry(name: string, sourceRestaurantId: string): BrandBlacklistEntry {
  const now = new Date().toISOString();
  const canonicalName = extractCanonicalBrand(name);
  return {
    id: `brand-${canonicalName}-${Date.now()}`,
    canonicalName,
    aliases: [],
    sourceRestaurantIds: [sourceRestaurantId],
    sourceNames: [name],
    createdBy: "user",
    createdAt: now,
    updatedAt: now,
  };
}
