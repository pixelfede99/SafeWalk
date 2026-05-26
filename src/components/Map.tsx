"use client";

import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GeoPoint, LocationPoint } from "@/types";

// El ícono por defecto de Leaflet usa rutas relativas que rompen en Next.js;
// reemplazamos con un divIcon SVG inline para tener un marker bonito.
const caneIcon = L.divIcon({
  className: "",
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  html: `
    <div style="
      width:40px;height:40px;border-radius:50%;
      background:#2563eb;border:3px solid #fff;
      box-shadow:0 0 0 4px rgba(37,99,235,0.3),0 4px 12px rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;
    ">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round">
        <path d="M9 3v18M9 3l3 1M6 19l3 2"/>
        <circle cx="9" cy="5" r="1.5" fill="white"/>
      </svg>
    </div>`
});

const alertIcon = L.divIcon({
  className: "",
  iconSize: [44, 44],
  iconAnchor: [22, 22],
  html: `
    <div style="
      width:44px;height:44px;border-radius:50%;
      background:#ef4444;border:3px solid #fff;
      box-shadow:0 0 0 4px rgba(239,68,68,0.4),0 4px 12px rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;
      animation:pulse 2s infinite;
    ">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" stroke-width="2.5">
        <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      </svg>
    </div>`
});

interface MapProps {
  center: GeoPoint;
  trail?: LocationPoint[];
  alertLocation?: GeoPoint | null;
  zoom?: number;
  height?: string;
}

export default function Map({ center, trail = [], alertLocation = null, zoom = 16, height = "100%" }: MapProps) {
  const polylinePositions = useMemo<[number, number][]>(
    () => trail.map((p) => [p.lat, p.lng]),
    [trail]
  );

  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={zoom}
      style={{ height, width: "100%" }}
      zoomControl={true}
      attributionControl={true}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />

      {polylinePositions.length > 1 && (
        <Polyline
          positions={polylinePositions}
          pathOptions={{ color: "#3b82f6", weight: 4, opacity: 0.85 }}
        />
      )}

      <Marker position={[center.lat, center.lng]} icon={caneIcon} />

      {alertLocation && (
        <Marker position={[alertLocation.lat, alertLocation.lng]} icon={alertIcon} />
      )}

      <Recenter center={center} />
      <InvalidateOnMount />
    </MapContainer>
  );
}

function Recenter({ center }: { center: GeoPoint }) {
  const map = useMap();
  const last = useRef<string>("");

  useEffect(() => {
    const key = `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;
    if (key === last.current) return;
    last.current = key;
    map.panTo([center.lat, center.lng], { animate: true, duration: 0.5 });
  }, [center, map]);

  return null;
}

/** Fuerza a Leaflet a recalcular el tamaño después del montaje.
 *  Sin esto, si el contenedor cambia de tamaño después del primer render,
 *  el mapa queda gris/vacío. */
function InvalidateOnMount() {
  const map = useMap();
  useEffect(() => {
    const timers = [50, 200, 500, 1000].map((ms) =>
      setTimeout(() => map.invalidateSize(), ms)
    );
    return () => timers.forEach(clearTimeout);
  }, [map]);
  return null;
}
