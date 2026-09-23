"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Crosshair, KeyRound, LoaderCircle, MapPinned, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MapViewport, Restaurant } from "@/lib/restaurant-types";
import { thinMapPoints } from "@/lib/map-density";

type MapCenter = { longitude: number; latitude: number };
type AMapPoint = { getLng(): number; getLat(): number };
type AMapPixel = { getX(): number; getY(): number };
type AMapBounds = { getSouthWest(): AMapPoint; getNorthEast(): AMapPoint };
type AMapMarker = { on(event: string, handler: () => void): void };
type AMapMap = {
  add(markers: AMapMarker | AMapMarker[]): void;
  remove(markers: AMapMarker | AMapMarker[]): void;
  destroy(): void;
  getCenter(): AMapPoint;
  getBounds(): AMapBounds;
  getZoom(): number;
  lngLatToContainer(position: [number, number]): AMapPixel;
  on(event: string, handler: () => void): void;
  off?(event: string, handler: () => void): void;
  setCenter(position: [number, number], immediately?: boolean): void;
  setZoom(zoom: number, immediately?: boolean): void;
  zoomIn(): void;
  zoomOut(): void;
};
type AMapNamespace = {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapMap;
  Marker: new (options: Record<string, unknown>) => AMapMarker;
  Pixel: new (x: number, y: number) => unknown;
  Geolocation: new (options: Record<string, unknown>) => {
    getCurrentPosition(callback: (status: string, result: {
      position?: AMapPoint;
      accuracy?: number;
      location_type?: string;
      message?: string;
    }) => void): void;
  };
  plugin(plugins: string[], callback: () => void): void;
};

declare global {
  interface Window {
    AMap?: AMapNamespace;
    _AMapSecurityConfig?: { securityJsCode: string };
  }
}

let amapLoader: Promise<AMapNamespace> | null = null;

const TILE_SIZE = 256;
const MIN_TILE_ZOOM = 10;
const MAX_TILE_ZOOM = 13;
const DEFAULT_CENTER = { longitude: 116.397428, latitude: 39.90923 };

function readViewport(map: AMapMap): MapViewport {
  const currentCenter = map.getCenter();
  const bounds = map.getBounds();
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();
  return {
    center: { longitude: currentCenter.getLng(), latitude: currentCenter.getLat() },
    zoom: map.getZoom(),
    bounds: {
      west: southWest.getLng(), south: southWest.getLat(),
      east: northEast.getLng(), north: northEast.getLat(),
    },
  };
}

function worldPosition(longitude: number, latitude: number, zoom: number) {
  const scale = 2 ** zoom;
  const x = ((longitude + 180) / 360) * scale;
  const clampedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const radians = clampedLatitude * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2 * scale;
  return { x, y };
}

function tileUrl(server: number, x: number, y: number, zoom: number) {
  return `https://webrd0${server}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x=${x}&y=${y}&z=${zoom}`;
}

function renderInitialRaster(layer: HTMLDivElement, center: MapCenter) {
  const width = layer.clientWidth;
  const height = layer.clientHeight;
  if (!width || !height) return;
  const tileZoom = MAX_TILE_ZOOM;
  const world = worldPosition(center.longitude, center.latitude, tileZoom);
  const maxTile = 2 ** tileZoom - 1;
  const minX = Math.floor(world.x - width / TILE_SIZE / 2) - 1;
  const maxX = Math.ceil(world.x + width / TILE_SIZE / 2) + 1;
  const minY = Math.max(0, Math.floor(world.y - height / TILE_SIZE / 2) - 1);
  const maxY = Math.min(maxTile, Math.ceil(world.y + height / TILE_SIZE / 2) + 1);
  const buffer = document.createElement("div");
  buffer.className = "real-map-raster-buffer";
  buffer.style.opacity = "1";
  const fragment = document.createDocumentFragment();
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const wrappedX = ((x % (maxTile + 1)) + maxTile + 1) % (maxTile + 1);
      const server = ((wrappedX + y) % 4) + 1;
      const image = document.createElement("img");
      image.alt = "";
      image.decoding = "async";
      image.draggable = false;
      image.style.left = `${width / 2 + (x - world.x) * TILE_SIZE}px`;
      image.style.top = `${height / 2 + (y - world.y) * TILE_SIZE}px`;
      image.src = tileUrl(server, wrappedX, y, tileZoom);
      fragment.appendChild(image);
    }
  }
  buffer.appendChild(fragment);
  layer.replaceChildren(buffer);
}

function createRasterController(layer: HTMLDivElement, map: AMapMap) {
  let disposed = false;
  let frame: number | null = null;
  let swapTimer: number | null = null;
  let anchor: { x: number; y: number; zoom: number; tileZoom: number } | null = null;
  let renderedKey = "";
  let activeLayer: HTMLDivElement | null = layer.querySelector<HTMLDivElement>(".real-map-raster-buffer");
  let pendingLayer: HTMLDivElement | null = null;

  function tileZoomFor(zoom: number) {
    return Math.max(MIN_TILE_ZOOM, Math.min(MAX_TILE_ZOOM, Math.round(zoom)));
  }

  function currentView() {
    const point = map.getCenter();
    const width = layer.clientWidth;
    const height = layer.clientHeight;
    const zoom = map.getZoom();
    const tileZoom = tileZoomFor(zoom);
    const world = worldPosition(point.getLng(), point.getLat(), tileZoom);
    return { width, height, zoom, tileZoom, world };
  }

  function viewKey(view: ReturnType<typeof currentView>) {
    return `${view.tileZoom}:${Math.floor(view.world.x)}:${Math.floor(view.world.y)}:${view.width}:${view.height}`;
  }

  if (activeLayer) renderedKey = viewKey(currentView());

  function applyGesture() {
    frame = null;
    if (disposed || !anchor) return;
    const view = currentView();
    const dx = (anchor.x - view.world.x) * TILE_SIZE;
    const dy = (anchor.y - view.world.y) * TILE_SIZE;
    const scale = 2 ** (view.zoom - anchor.zoom);
    layer.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`;
  }

  function scheduleGesture() {
    if (frame !== null) return;
    frame = window.requestAnimationFrame(applyGesture);
  }

  function ensureTiles() {
    if (disposed) return;
    const view = currentView();
    const key = viewKey(view);
    if (key === renderedKey) {
      anchor = { x: view.world.x, y: view.world.y, zoom: view.zoom, tileZoom: view.tileZoom };
      layer.style.transform = "none";
      return;
    }

    if (pendingLayer) pendingLayer.remove();
    if (swapTimer !== null) window.clearTimeout(swapTimer);

    const minX = Math.floor(view.world.x - view.width / TILE_SIZE / 2) - 1;
    const maxX = Math.ceil(view.world.x + view.width / TILE_SIZE / 2) + 1;
    const maxTile = 2 ** view.tileZoom - 1;
    const minY = Math.max(0, Math.floor(view.world.y - view.height / TILE_SIZE / 2) - 1);
    const maxY = Math.min(maxTile, Math.ceil(view.world.y + view.height / TILE_SIZE / 2) + 1);
    const fragment = document.createDocumentFragment();
    const nextLayer = document.createElement("div");
    nextLayer.className = "real-map-raster-buffer";
    nextLayer.style.opacity = "0";
    nextLayer.style.width = `${view.width}px`;
    nextLayer.style.height = `${view.height}px`;

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const wrappedX = ((x % (maxTile + 1)) + maxTile + 1) % (maxTile + 1);
        const server = ((wrappedX + y) % 4) + 1;
        const image = document.createElement("img");
        image.alt = "";
        image.decoding = "async";
        image.draggable = false;
        image.style.left = `${view.width / 2 + (x - view.world.x) * TILE_SIZE}px`;
        image.style.top = `${view.height / 2 + (y - view.world.y) * TILE_SIZE}px`;
        image.src = tileUrl(server, wrappedX, y, view.tileZoom);
        fragment.appendChild(image);
      }
    }
    nextLayer.appendChild(fragment);
    pendingLayer = nextLayer;
    if (activeLayer) layer.appendChild(nextLayer);
    else layer.replaceChildren(nextLayer);

    const images = [...nextLayer.querySelectorAll("img")];
    let loaded = 0;
    let swapped = false;
    const commit = () => {
      if (swapped || disposed || pendingLayer !== nextLayer) return;
      if (viewKey(currentView()) !== key) {
        pendingLayer?.remove();
        pendingLayer = null;
        return;
      }
      swapped = true;
      if (swapTimer !== null) window.clearTimeout(swapTimer);
      nextLayer.style.opacity = "1";
      activeLayer?.remove();
      activeLayer = nextLayer;
      pendingLayer = null;
      layer.style.transform = "none";
      anchor = { x: view.world.x, y: view.world.y, zoom: view.zoom, tileZoom: view.tileZoom };
      renderedKey = key;
    };
    const required = Math.min(12, images.length);
    const markLoaded = () => {
      loaded += 1;
      if (loaded >= required) commit();
    };
    images.forEach((image) => {
      image.addEventListener("load", markLoaded, { once: true });
      image.addEventListener("error", markLoaded, { once: true });
    });
    swapTimer = window.setTimeout(commit, 1500);
  }

  function dispose() {
    disposed = true;
    if (frame !== null) window.cancelAnimationFrame(frame);
    if (swapTimer !== null) window.clearTimeout(swapTimer);
    layer.replaceChildren();
    activeLayer = null;
    pendingLayer = null;
  }

  return { ensureTiles, scheduleGesture, dispose };
}

function loadAmap(apiKey: string, securityCode: string) {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (amapLoader) return amapLoader;

  window._AMapSecurityConfig = { securityJsCode: securityCode };
  amapLoader = new Promise<AMapNamespace>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-hidden-gem-amap]");
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.dataset.hiddenGemAmap = "true";
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(apiKey)}`;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => {
      if (window.AMap) resolve(window.AMap);
      else reject(new Error("高德地图脚本已加载，但地图对象不可用。"));
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("高德地图脚本加载失败。")), { once: true });
  });
  return amapLoader;
}

export function RealMap({
  apiKey,
  securityCode,
  center,
  restaurants,
  selectedId,
  onCenterChange,
  onLocationAccuracy,
  onViewportChange,
  onSelect,
  densityEnabled = true,
  onDensityStats,
}: {
  apiKey: string;
  securityCode: string;
  center: MapCenter | null;
  restaurants: Restaurant[];
  selectedId: string | null;
  onCenterChange: (center: MapCenter) => void;
  onLocationAccuracy: (accuracy: number | null) => void;
  onViewportChange?: (viewport: MapViewport) => void;
  onSelect: (id: string) => void;
  densityEnabled?: boolean;
  onDensityStats?: (stats: { total: number; displayed: number }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapMap | null>(null);
  const markersRef = useRef<AMapMarker[]>([]);
  const initialCenterRef = useRef(center);
  const acceptMapMovesRef = useRef(Boolean(center));
  const suppressNextMoveEndRef = useRef(false);
  const centerCallbackRef = useRef(onCenterChange);
  const locationAccuracyCallbackRef = useRef(onLocationAccuracy);
  const viewportCallbackRef = useRef(onViewportChange);
  const selectCallbackRef = useRef(onSelect);
  const rasterLayerRef = useRef<HTMLDivElement>(null);
  const [mapState, setMapState] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [locating, setLocating] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);

  useEffect(() => {
    const ignoreEmptyMapSdkRejection = (event: PromiseRejectionEvent) => {
      if (event.reason === null || event.reason === undefined) event.preventDefault();
    };
    window.addEventListener("unhandledrejection", ignoreEmptyMapSdkRejection);
    return () => window.removeEventListener("unhandledrejection", ignoreEmptyMapSdkRejection);
  }, []);

  const requestPreciseLocation = useCallback((AMap: AMapNamespace, map: AMapMap, automatic = false) => {
    setLocating(true);
    AMap.plugin(["AMap.Geolocation"], () => {
      const geolocation = new AMap.Geolocation({
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
        convert: true,
        showButton: false,
        showMarker: true,
        showCircle: true,
        panToLocation: true,
        zoomToAccuracy: true,
      });
      geolocation.getCurrentPosition((status, result) => {
        if (status !== "complete" || !result.position) {
          setErrorMessage(automatic
            ? "当前仅能按网络定位到城市；允许浏览器精确位置，或拖动地图选择区域。"
            : "未能取得精确位置，请检查浏览器位置权限，或拖动地图选择区域。");
          setLocating(false);
          return;
        }
        const accuracy = Number.isFinite(result.accuracy) ? Number(result.accuracy) : null;
        if (accuracy === null || accuracy > 1000 || result.location_type === "ip") {
          locationAccuracyCallbackRef.current(null);
          setErrorMessage("只获得了城市级网络定位，未将它当作精确位置；请允许浏览器精确位置或手动拖动地图。");
          setLocating(false);
          return;
        }
        const nextCenter = {
          longitude: result.position.getLng(),
          latitude: result.position.getLat(),
        };
        suppressNextMoveEndRef.current = true;
        map.setCenter([nextCenter.longitude, nextCenter.latitude], true);
        map.setZoom(15, true);
        centerCallbackRef.current(nextCenter);
        locationAccuracyCallbackRef.current(accuracy);
        setErrorMessage(accuracy > 200 ? `定位精度约 ${Math.round(accuracy)} 米，可拖动地图微调。` : "");
        setLocating(false);
      });
    });
  }, []);

  useEffect(() => { centerCallbackRef.current = onCenterChange; }, [onCenterChange]);
  useEffect(() => { locationAccuracyCallbackRef.current = onLocationAccuracy; }, [onLocationAccuracy]);
  useEffect(() => { viewportCallbackRef.current = onViewportChange; }, [onViewportChange]);
  useEffect(() => { selectCallbackRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    const layer = rasterLayerRef.current;
    if (!layer) return;
    const frame = window.requestAnimationFrame(() => {
      if (!layer.firstElementChild) renderInitialRaster(layer, center ?? DEFAULT_CENTER);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [center]);

  useEffect(() => {
    if (!apiKey || !securityCode || !containerRef.current) return;
    let active = true;
    let map: AMapMap | null = null;
    let enableMapMovesTimer: number | null = null;
    let rasterController: ReturnType<typeof createRasterController> | null = null;

    void loadAmap(apiKey, securityCode)
      .then((AMap) => {
        if (!active || !containerRef.current) return;
        const initialCenter = initialCenterRef.current ?? DEFAULT_CENTER;
        map = new AMap.Map(containerRef.current, {
          center: [initialCenter.longitude, initialCenter.latitude],
          zoom: 15,
          zooms: [11, 17],
          viewMode: "2D",
          animateEnable: false,
          jogEnable: false,
        });
        if (rasterLayerRef.current) rasterController = createRasterController(rasterLayerRef.current, map);
        const publishViewport = () => {
          if (!map) return;
          viewportCallbackRef.current?.(readViewport(map));
        };
        const handleMapMove = () => rasterController?.scheduleGesture();
        const handleZoomChange = () => rasterController?.scheduleGesture();
        map.on("moveend", () => {
          setLayoutVersion((value) => value + 1);
          rasterController?.ensureTiles();
          publishViewport();
          if (!map || !acceptMapMovesRef.current) return;
          if (suppressNextMoveEndRef.current) {
            suppressNextMoveEndRef.current = false;
            return;
          }
          const point = map.getCenter();
          locationAccuracyCallbackRef.current(null);
          centerCallbackRef.current({ longitude: point.getLng(), latitude: point.getLat() });
        });
        map.on("zoomend", () => {
          setLayoutVersion((value) => value + 1);
          rasterController?.ensureTiles();
          publishViewport();
        });
        map.on("mapmove", handleMapMove);
        map.on("zoomchange", handleZoomChange);
        map.on("resize", () => {
          setLayoutVersion((value) => value + 1);
          rasterController?.ensureTiles();
          publishViewport();
        });
        mapRef.current = map;
        rasterController?.ensureTiles();
        publishViewport();
        setMapState("ready");
        enableMapMovesTimer = window.setTimeout(() => { acceptMapMovesRef.current = true; }, 1200);
        requestPreciseLocation(AMap, map, true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMapState("error");
        setErrorMessage(error instanceof Error ? error.message : "地图加载失败。");
      });

    return () => {
      active = false;
      if (enableMapMovesTimer !== null) window.clearTimeout(enableMapMovesTimer);
      rasterController?.dispose();
      if (map) map.destroy();
      mapRef.current = null;
    };
  }, [apiKey, requestPreciseLocation, securityCode]);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = window.AMap;
    if (!map || !AMap || mapState !== "ready") return;

    if (markersRef.current.length) map.remove(markersRef.current);
    let displayedRestaurants = restaurants;
    if (densityEnabled && restaurants.length > 1) {
      const points = restaurants.map((restaurant) => {
        const pixel = map.lngLatToContainer([restaurant.longitude, restaurant.latitude]);
        return {
          id: restaurant.id,
          x: pixel.getX(),
          y: pixel.getY(),
          score: restaurant.recommendation?.score ?? (restaurant.rating ?? 0),
          item: restaurant,
        };
      });
      displayedRestaurants = thinMapPoints(points, map.getZoom(), selectedId).accepted.map((point) => point.item);
    }
    onDensityStats?.({ total: restaurants.length, displayed: displayedRestaurants.length });
    const markers = displayedRestaurants.map((restaurant) => {
      const candidateScore = restaurant.recommendation?.score ?? null;
      const candidateTier = candidateScore === null ? "unknown" : candidateScore >= 60 ? "high" : candidateScore >= 50 ? "medium" : candidateScore >= 40 ? "low" : "weak";
      const markerElement = document.createElement("button");
      markerElement.type = "button";
      markerElement.className = `real-map-marker marker-candidate-${candidateTier}${restaurant.id === selectedId ? " selected" : ""}`;
      markerElement.setAttribute("aria-label", `${restaurant.name}，候选分 ${candidateScore ?? "暂无"}，高德评分 ${restaurant.rating?.toFixed(1) ?? "暂无"}`);
      const score = document.createElement("strong");
      score.textContent = candidateScore?.toString() ?? "–";
      const name = document.createElement("span");
      name.textContent = restaurant.name;
      markerElement.appendChild(score);
      markerElement.appendChild(name);

      const marker = new AMap.Marker({
        position: [restaurant.longitude, restaurant.latitude],
        content: markerElement,
        offset: new AMap.Pixel(-22, -45),
        title: restaurant.name,
        zIndex: restaurant.id === selectedId ? 180 : 120,
      });
      marker.on("click", () => selectCallbackRef.current(restaurant.id));
      markerElement.addEventListener("click", () => selectCallbackRef.current(restaurant.id));
      return marker;
    });
    markersRef.current = markers;
    if (markers.length) map.add(markers);
  }, [densityEnabled, layoutVersion, mapState, onDensityStats, restaurants, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center || mapState !== "ready") return;
    const current = map.getCenter();
    const moved = Math.abs(current.getLng() - center.longitude) > 0.00001
      || Math.abs(current.getLat() - center.latitude) > 0.00001;
    if (moved) {
      suppressNextMoveEndRef.current = true;
      map.setCenter([center.longitude, center.latitude], true);
    }
  }, [center, mapState]);

  function locateUser() {
    const AMap = window.AMap;
    const map = mapRef.current;
    if (!AMap || !map) {
      setErrorMessage("地图尚未完成加载。");
      return;
    }
    requestPreciseLocation(AMap, map);
  }

  function changeZoom(delta: number) {
    const map = mapRef.current;
    if (!map) return;
    if (delta > 0) map.zoomIn();
    else map.zoomOut();
    window.setTimeout(() => {
      viewportCallbackRef.current?.(readViewport(map));
      setLayoutVersion((value) => value + 1);
    }, 80);
  }

  if (!apiKey || !securityCode) {
    return (
      <div className="map-setup-state">
        <KeyRound />
        <h2>等待配置高德地图密钥</h2>
        <p>配置完成后，这里会显示真实地图和真实餐馆位置。</p>
        <code>NEXT_PUBLIC_AMAP_JS_KEY</code>
        <code>NEXT_PUBLIC_AMAP_SECURITY_JS_CODE</code>
      </div>
    );
  }

  return (
    <div className="real-map-shell">
      <div ref={rasterLayerRef} className="real-map-raster" aria-hidden="true" />
      <div ref={containerRef} className="real-map-canvas" aria-label="真实餐馆地图" />
      {mapState === "loading" && <div className="map-loading"><LoaderCircle className="spin" /><span>正在加载真实地图</span></div>}
      {mapState === "error" && <div className="map-error"><MapPinned /><b>地图加载失败</b><span>{errorMessage}</span></div>}
      {errorMessage && mapState === "ready" && <p className="map-inline-error">{errorMessage}</p>}
      <Button size="icon" variant="outline" className="locate-button" onClick={locateUser} aria-label="定位到当前位置" disabled={locating}>
        {locating ? <LoaderCircle className="spin" /> : <Crosshair />}
      </Button>
      <div className="map-zoom-controls" aria-label="地图缩放">
        <Button size="icon" variant="outline" onClick={() => changeZoom(1)} aria-label="放大地图"><Plus /></Button>
        <Button size="icon" variant="outline" onClick={() => changeZoom(-1)} aria-label="缩小地图"><Minus /></Button>
      </div>
    </div>
  );
}
