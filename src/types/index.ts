import type { Timestamp } from "firebase/firestore";

export type UserRole = "blind_user" | "caregiver";

export interface UserDoc {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  deviceId: string | null;
  createdAt: Timestamp;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface DeviceDoc {
  deviceId: string;
  name: string;
  ownerUid: string;
  caregiverUids: string[];
  batteryLevel: number;
  isOnline: boolean;
  lastSeen: Timestamp;
  location: GeoPoint;
  speed: number;
  bluetoothId?: string;
}

export interface LocationPoint {
  lat: number;
  lng: number;
  timestamp: Timestamp;
}

export interface AlertDoc {
  id: string;
  deviceId: string;
  timestamp: Timestamp;
  location: GeoPoint;
  photoUrl: string;
  audioUrl: string;
  seen: boolean;
  seenBy?: string[];
}
