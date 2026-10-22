import type { Timestamp } from "firebase/firestore";

export type UserRole = "blind_user" | "caregiver";

export interface UserDoc {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  deviceId: string | null;     // dispositivo/círculo ACTIVO (el que se está viendo)
  deviceIds?: string[];        // TODOS los dispositivos/círculos a los que pertenece
  createdAt: Timestamp;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface DeviceDoc {
  deviceId: string;
  name: string;
  /** null = sin dueño (el dueño lo eliminó y no había cuidadores). */
  ownerUid: string | null;
  caregiverUids: string[];
  batteryLevel: number;
  isOnline: boolean;
  lastSeen: Timestamp;
  /** 0,0 = el bastón nunca tuvo GPS (no hay ubicación). */
  location: GeoPoint;
  /**
   * Lo manda el firmware en cada heartbeat: true si el GPS tiene fix AHORA.
   * false = `location` es la última posición conocida. Con firmware viejo no viene.
   */
  gpsFix?: boolean;
  speed: number;
  bluetoothId?: string;
  inviteCode?: string;

  // ---- "Encontrar el bastón" ----
  // Los escribe la app y el bastón los recibe en la respuesta de su heartbeat
  // (sin gastar lecturas de la cuota de Firestore). Antes vivían en una colección
  // aparte, commands/{deviceId}, que el bastón leía con un GET cada 5 s.
  /**
   * Cambia en cada pedido (Date.now()). Es un nonce: el firmware NO lo compara
   * por orden, solo mira si cambió; así anda aunque el reloj del celular esté mal.
   */
  ringToken?: number;
  /** Segundos que tiene que sonar. 0 = parar. El firmware lo limita por las suyas. */
  ringSeconds?: number;
  ringRequestedBy?: string;
  ringRequestedAt?: Timestamp;
  /**
   * Eco que escribe el bastón con el `ringToken` que efectivamente ejecutó.
   * Es la única confirmación real de que la orden llegó: sin esto la app le
   * estaría diciendo "está sonando" a alguien que no puede verificarlo.
   */
  ackToken?: number;
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
  /** Quién disparó la alerta: el botón físico del bastón o el SOS de respaldo de la PWA. */
  source?: "device" | "pwa_sos";
  /** Qué la disparó en el bastón (firmware nuevo). */
  trigger?: "boton" | "caida" | "prueba";
  /**
   * De dónde salió `location`. Importa mucho en el SOS de la PWA: si el usuario
   * se separó del bastón, la ubicación del bastón NO es la del usuario.
   *   device      -> GPS del bastón (con fix en ese momento)
   *   device_last -> última posición conocida del bastón (el GPS había perdido señal)
   *   phone       -> GPS del teléfono (SOS de la app)
   *   unknown     -> no hay ubicación (location = 0,0)
   */
  locationSource?: "device" | "device_last" | "phone" | "unknown";
}
