export type ReviewCapture = {
  id: string;
  restaurantId: string;
  restaurantName: string;
  sourceUrl: string;
  text: string;
  screenshotName: string | null;
  capturedAt: string;
  confirmedByUser: true;
};

const META_KEY = "hidden-gem-v5-review-captures";
const DB_NAME = "hidden-gem-v5-review-evidence";
const STORE_NAME = "screenshots";

export function loadReviewCaptures(): ReviewCapture[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(META_KEY) ?? "[]") as ReviewCapture[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveReviewCapture(capture: ReviewCapture, screenshot: File | null) {
  const current = loadReviewCaptures();
  window.localStorage.setItem(META_KEY, JSON.stringify([capture, ...current]));
  if (!screenshot) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(screenshot, capture.id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function loadReviewScreenshot(id: string) {
  const database = await openDatabase();
  const result = await new Promise<Blob | null>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return result;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
