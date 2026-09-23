export type RestaurantStatus = "high" | "potential" | "explore";

export type RestaurantPhoto = {
  title: string;
  url: string;
};

export type Restaurant = {
  id: string;
  provider: "amap";
  name: string;
  category: string;
  type: string;
  longitude: number;
  latitude: number;
  distanceMeters: number;
  address: string | null;
  telephone: string | null;
  businessArea: string | null;
  openingHours: string | null;
  rating: number | null;
  averageCost: number | null;
  tags: string[];
  photos: RestaurantPhoto[];
  dataCompleteness: number;
  status: RestaurantStatus;
  reasons: string[];
  fetchedAt: string;
  recommendation?: RecommendationScore;
};

export type RecommendationFeature = {
  key: string;
  label: string;
  value: number | null;
  weight: number;
  contribution: number;
  source: "amap" | "user" | "derived";
  note: string;
};

export type RecommendationScore = {
  score: number;
  baseScore: number;
  personalAdjustment: number;
  personalEvidence: Array<{ label: string; adjustment: number; sampleCount: number }>;
  confidence: number;
  risk: number;
  features: RecommendationFeature[];
  missingFeatures: string[];
  formulaVersion: "v5-personal-1";
};

export type FilterReason =
  | "entertainment_type"
  | "entertainment_name"
  | "restaurant_blacklist"
  | "chain_brand_blacklist";

export type V4RestaurantLabel = {
  restaurantId: string;
  provider: "amap";
  originalName: string;
  normalizedName: string;
  canonicalBrand: string | null;
  labels: Array<"want" | "blacklist" | "chain" | "liked" | "average" | "not_interested">;
  reasons: string[];
  note: string;
  restaurantSnapshot: Restaurant;
  createdAt: string;
  updatedAt: string;
};

export type BrandBlacklistEntry = {
  id: string;
  canonicalName: string;
  aliases: string[];
  sourceRestaurantIds: string[];
  sourceNames: string[];
  createdBy: "user";
  createdAt: string;
  updatedAt: string;
};

export type RestaurantSearchResponse = {
  source: "amap";
  sourceLabel: string;
  fetchedAt: string;
  center: { longitude: number; latitude: number };
  radiusMeters: number;
  restaurants: Restaurant[];
  searchPlan?: {
    zoom: number;
    gridColumns: number;
    gridRows: number;
    queryCount: number;
    completedQueries: number;
    partial: boolean;
    bounds: MapBounds;
  };
};

export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type MapViewport = {
  center: { longitude: number; latitude: number };
  zoom: number;
  bounds: MapBounds;
};

export type RestaurantSearchError = {
  error: string;
  code: "AMAP_KEY_MISSING" | "INVALID_REQUEST" | "UPSTREAM_ERROR";
};
