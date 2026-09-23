import { normalizeRestaurantName } from "@/lib/brand-normalizer";
import type { BrandBlacklistEntry, Restaurant, V4RestaurantLabel } from "@/lib/restaurant-types";
import { loadReviewCaptures, loadReviewScreenshot, saveReviewScreenshot, type ReviewCapture } from "@/lib/review-capture-storage";
import { emptyV4State, loadV4State, saveV4State, type V4State } from "@/lib/v4-storage";

const FEEDBACK_KEY = "hidden-gem-v2-feedback";
const EXTERNAL_LINKS_KEY = "hidden-gem-v3-external-links";
const UI_SETTINGS_KEY = "hidden-gem-v5-ui-settings";
const REVIEW_META_KEY = "hidden-gem-v5-review-captures";
const BACKUP_VERSION = "hidden-gem-v5-backup-1";

type JsonObject = Record<string, unknown>;
type ReviewImage = { id: string; dataUrl: string };
type Backup = {
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  state: V4State;
  feedback: Record<string, string>;
  externalLinks: Record<string, string>;
  uiSettings: { viewMode: "map" | "list" | "split"; minCandidateScore: number };
  reviewCaptures: ReviewCapture[];
  reviewImages: ReviewImage[];
};

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function stringRecord(value: unknown): Record<string, string> {
  const source = object(value);
  if (!source) return {};
  return Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function readJson(key: string): unknown {
  try { return JSON.parse(window.localStorage.getItem(key) ?? "null"); }
  catch { return null; }
}

function uiSettings(value: unknown): Backup["uiSettings"] {
  const source = object(value);
  const viewMode = source?.viewMode;
  const score = Number(source?.minCandidateScore);
  return {
    viewMode: viewMode === "list" || viewMode === "split" ? viewMode : "map",
    minCandidateScore: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
  };
}

function validCapture(value: unknown): value is ReviewCapture {
  const item = object(value);
  return Boolean(item && typeof item.id === "string" && typeof item.restaurantId === "string"
    && typeof item.restaurantName === "string" && typeof item.sourceUrl === "string"
    && typeof item.text === "string" && typeof item.capturedAt === "string");
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("无法读取评论截图"));
    reader.onerror = () => reject(reader.error ?? new Error("无法读取评论截图"));
    reader.readAsDataURL(blob);
  });
}

function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportPortableBackup(): Promise<{ labels: number; reviews: number; images: number }> {
  const reviewCaptures = loadReviewCaptures();
  const reviewImages: ReviewImage[] = [];
  for (const capture of reviewCaptures) {
    const screenshot = await loadReviewScreenshot(capture.id);
    if (screenshot) reviewImages.push({ id: capture.id, dataUrl: await toDataUrl(screenshot) });
  }
  const state = loadV4State();
  const backup: Backup = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    state,
    feedback: stringRecord(readJson(FEEDBACK_KEY)),
    externalLinks: stringRecord(readJson(EXTERNAL_LINKS_KEY)),
    uiSettings: uiSettings(readJson(UI_SETTINGS_KEY)),
    reviewCaptures,
    reviewImages,
  };
  downloadJson(backup, `hidden-gem-radar-backup-${new Date().toISOString().slice(0, 10)}.json`);
  return { labels: Object.keys(state.restaurantLabels).length, reviews: reviewCaptures.length, images: reviewImages.length };
}

function parseV4State(value: unknown): V4State {
  const source = object(value);
  if (!source || source.version !== 1 || !object(source.restaurantLabels)
    || !Array.isArray(source.brandBlacklist) || !Array.isArray(source.entertainmentWhitelist)) {
    throw new Error("备份中的标签数据格式无效");
  }
  const labels = Object.fromEntries(Object.entries(source.restaurantLabels as JsonObject).filter((entry): entry is [string, V4RestaurantLabel] => {
    const item = object(entry[1]);
    return Boolean(item && typeof item.restaurantId === "string" && object(item.restaurantSnapshot)
      && Array.isArray(item.labels) && Array.isArray(item.reasons));
  }));
  const settings = object(source.settings);
  return {
    version: 1,
    restaurantLabels: labels,
    brandBlacklist: source.brandBlacklist.filter((value): value is BrandBlacklistEntry => {
      const entry = object(value);
      return Boolean(entry && typeof entry.id === "string" && typeof entry.canonicalName === "string"
        && Array.isArray(entry.sourceRestaurantIds) && Array.isArray(entry.sourceNames));
    }),
    entertainmentWhitelist: source.entertainmentWhitelist.filter((value): value is string => typeof value === "string"),
    settings: {
      showFiltered: settings?.showFiltered === true,
      densityEnabled: settings?.densityEnabled !== false,
    },
  };
}

function legacyLabelsToState(value: JsonObject): V4State {
  if (!Array.isArray(value.labels) || !Array.isArray(value.brandBlacklist)) throw new Error("标注文件格式无效");
  const state = emptyV4State();
  for (const raw of value.labels) {
    const item = object(raw);
    const restaurant = object(item?.restaurant) as Restaurant | null;
    if (!restaurant || typeof restaurant.id !== "string" || typeof restaurant.name !== "string" || !Array.isArray(item?.labels)) continue;
    const updatedAt = typeof item?.updatedAt === "string" ? item.updatedAt : new Date().toISOString();
    state.restaurantLabels[restaurant.id] = {
      restaurantId: restaurant.id,
      provider: "amap",
      originalName: restaurant.name,
      normalizedName: normalizeRestaurantName(restaurant.name),
      canonicalBrand: typeof item?.canonicalBrand === "string" ? item.canonicalBrand : null,
      labels: (item.labels as unknown[]).filter((label): label is V4RestaurantLabel["labels"][number] =>
        typeof label === "string" && ["want", "blacklist", "chain", "liked", "average", "not_interested"].includes(label)),
      reasons: Array.isArray(item.reasons) ? item.reasons.filter((reason): reason is string => typeof reason === "string") : [],
      note: typeof item.note === "string" ? item.note : "",
      restaurantSnapshot: restaurant,
      createdAt: updatedAt,
      updatedAt,
    };
  }
  state.brandBlacklist = value.brandBlacklist as BrandBlacklistEntry[];
  state.entertainmentWhitelist = Array.isArray(value.entertainmentWhitelist)
    ? value.entertainmentWhitelist.filter((id): id is string => typeof id === "string") : [];
  return state;
}

function mergeState(current: V4State, imported: V4State): V4State {
  const restaurantLabels = { ...current.restaurantLabels };
  for (const [id, label] of Object.entries(imported.restaurantLabels)) {
    const previous = restaurantLabels[id];
    if (!previous || label.updatedAt >= previous.updatedAt) restaurantLabels[id] = label;
  }
  const brandMap = new Map<string, BrandBlacklistEntry>();
  for (const brand of [...current.brandBlacklist, ...imported.brandBlacklist]) {
    const key = brand.canonicalName.trim().toLocaleLowerCase();
    const previous = brandMap.get(key);
    brandMap.set(key, previous ? {
      ...brand,
      aliases: Array.from(new Set([...(previous.aliases ?? []), ...(brand.aliases ?? [])])),
      sourceRestaurantIds: Array.from(new Set([...previous.sourceRestaurantIds, ...brand.sourceRestaurantIds])),
      sourceNames: Array.from(new Set([...previous.sourceNames, ...brand.sourceNames])),
    } : brand);
  }
  return {
    version: 1,
    restaurantLabels,
    brandBlacklist: [...brandMap.values()],
    entertainmentWhitelist: Array.from(new Set([...current.entertainmentWhitelist, ...imported.entertainmentWhitelist])),
    settings: imported.settings,
  };
}

export async function importPortableBackup(file: File): Promise<{ labels: number; reviews: number; images: number }> {
  const parsed = object(JSON.parse(await file.text()));
  if (!parsed) throw new Error("文件不是有效的备份 JSON");
  const fullBackup = parsed.version === BACKUP_VERSION;
  if (!fullBackup && parsed.version !== "v5-labels-1") throw new Error("不支持的备份版本");
  const imported = fullBackup ? parseV4State(parsed.state) : legacyLabelsToState(parsed);
  const nextState = mergeState(loadV4State(), imported);
  const captures = fullBackup && Array.isArray(parsed.reviewCaptures) ? parsed.reviewCaptures.filter(validCapture) : [];
  const imageRecords = fullBackup && Array.isArray(parsed.reviewImages) ? parsed.reviewImages : [];
  let images = 0;
  for (const raw of imageRecords) {
    const image = object(raw);
    if (!image || typeof image.id !== "string" || typeof image.dataUrl !== "string" || !image.dataUrl.startsWith("data:image/")) continue;
    const response = await fetch(image.dataUrl);
    await saveReviewScreenshot(image.id, await response.blob());
    images++;
  }
  saveV4State(nextState);
  if (fullBackup) {
    window.localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ ...stringRecord(readJson(FEEDBACK_KEY)), ...stringRecord(parsed.feedback) }));
    window.localStorage.setItem(EXTERNAL_LINKS_KEY, JSON.stringify({ ...stringRecord(readJson(EXTERNAL_LINKS_KEY)), ...stringRecord(parsed.externalLinks) }));
    window.localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(uiSettings(parsed.uiSettings)));
    const existing = loadReviewCaptures();
    const reviewMap = new Map(existing.map((capture) => [capture.id, capture]));
    for (const capture of captures) reviewMap.set(capture.id, capture);
    window.localStorage.setItem(REVIEW_META_KEY, JSON.stringify([...reviewMap.values()]));
  }
  return { labels: Object.keys(imported.restaurantLabels).length, reviews: captures.length, images };
}
