# SafeWalk

PWA para el bastón inteligente **SafeWalk** — proyecto capstone de electrónica.

La página **solo lee** datos del bastón y muestra alertas. El ESP32 escribe en
Firestore directamente vía la REST API de Firebase, esta app no controla el bastón.

## Stack

- **Next.js 14** (App Router) + **TypeScript** + **Tailwind CSS**
- **Firebase**: Auth (email/password), Firestore (real-time), Storage (fotos/audios)
- **Leaflet.js** + OpenStreetMap (mapas gratuitos)
- **PWA** instalable (manifest + service worker)

## Estructura

```
src/
├── app/                   # rutas (App Router)
│   ├── login/             # ingreso
│   ├── register/          # alta de cuenta
│   ├── role-select/       # elegir blind_user vs caregiver
│   ├── pair/              # emparejamiento Bluetooth
│   ├── dashboard/         # vista del cuidador (mapa + panel)
│   ├── blind/             # vista simplificada del usuario no vidente
│   ├── alerts/            # historial de alertas con filtro de fecha
│   └── page.tsx           # router según estado del usuario
├── components/            # Map, DevicePanel, AlertBanner, BatteryIcon, etc.
├── context/AuthContext.tsx
├── hooks/                 # usePageVisibility, useDevice, useAlerts
├── lib/                   # firebase, auth, firestore, storage, bluetooth, notifications
└── types/                 # tipos compartidos
public/
├── manifest.json
├── sw.js                  # service worker
└── icons/                 # iconos PWA (ver icons/README.md)
firestore.rules            # reglas de seguridad para Firestore
storage.rules              # reglas para Firebase Storage
```

## Instalación

> **Pre-requisito:** Node.js 18+. Bajalo de https://nodejs.org/.

```bash
npm install
cp .env.local.example .env.local   # y completá con tus credenciales
npm run dev
```

Abre http://localhost:3000.

## Configuración de Firebase

1. Andá a la [consola de Firebase](https://console.firebase.google.com/) y
   creá un proyecto nuevo (ej. `safewalk-capstone`).
2. Habilitá **Authentication → Email/Password**.
3. Habilitá **Firestore Database** (modo producción).
4. Habilitá **Storage**.
5. En *Project Settings → General → Your apps*, agregá una **app web**.
   Copiá las credenciales que te muestra y pegalas en `.env.local`:

   ```
   NEXT_PUBLIC_FIREBASE_API_KEY=...
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
   NEXT_PUBLIC_FIREBASE_APP_ID=...
   ```

6. Subí las reglas de seguridad:

   ```bash
   npm install -g firebase-tools
   firebase login
   firebase init firestore storage   # apuntá a tu proyecto
   firebase deploy --only firestore:rules,storage:rules
   ```

   o copiá el contenido de `firestore.rules` y `storage.rules` desde la consola web.

## Modelo de datos en Firestore

```
users/{userId}
  - role: "blind_user" | "caregiver"
  - name: string
  - deviceId: string | null

devices/{deviceId}
  - ownerUid: string
  - caregiverUids: string[]
  - batteryLevel: number
  - isOnline: boolean
  - lastSeen: timestamp
  - location: { lat, lng }
  - speed: number
  - bluetoothId?: string

locations/{deviceId}/history/{auto-id}
  - lat: number
  - lng: number
  - timestamp: timestamp

alerts/{alertId}
  - deviceId: string
  - timestamp: timestamp
  - location: { lat, lng }
  - photoUrl: string  (Firebase Storage)
  - audioUrl: string  (Firebase Storage)
  - seen: boolean
  - seenBy?: string[]
  - source?: "device" | "pwa_sos"           # boton fisico del baston vs SOS de la app
  - locationSource?: "device"|"phone"|"unknown"   # de donde salio `location`

commands/{deviceId}          # ordenes de la APP -> BASTON (unico camino de ida)
  - ringToken: number        # nonce; el baston actua cuando cambia
  - ringSeconds: number      # cuanto sonar (0 = parar)
  - requestedBy: string      # uid de quien lo pidio
  - updatedAt: timestamp
  - ackToken?: number        # eco que escribe el BASTON al ejecutar la orden
```

> **Por qué `commands/` es una colección aparte y no un campo de `devices/`:**
> el heartbeat del ESP32 hace un PATCH **sin `updateMask`** sobre
> `devices/{deviceId}`, y eso en la REST API de Firestore reemplaza el documento
> entero. Una orden guardada ahí duraría menos de 10 segundos.

## Qué tiene que hacer el ESP32

El firmware del ESP32 publica estos datos en Firestore vía la REST API.
Te dejo los endpoints clave:

### Heartbeat (cada 5–10s mientras esté encendido)

```
PATCH https://firestore.googleapis.com/v1/projects/PROJECT_ID/databases/(default)/documents/devices/DEVICE_ID
Body:
{
  "fields": {
    "batteryLevel": { "integerValue": "78" },
    "isOnline":     { "booleanValue": true },
    "lastSeen":     { "timestampValue": "2026-05-08T12:34:56Z" },
    "location":     { "mapValue": { "fields": {
        "lat": { "doubleValue": -34.6037 },
        "lng": { "doubleValue": -58.3816 }
    }}},
    "speed":        { "doubleValue": 1.2 }
  }
}
```

### Punto de historial (a la frecuencia que quieras, 1 cada 10s alcanza)

```
POST .../documents/locations/DEVICE_ID/history
{ "fields": { "lat": ..., "lng": ..., "timestamp": ... } }
```

### Alerta (cuando el usuario presiona el botón físico)

1. Sacá foto + grabá 15s de audio.
2. Subí ambos a Firebase Storage en `alerts/{deviceId}/{timestamp}.jpg` y `.mp3`.
3. Pedí la URL pública con un GET firmado.
4. Creá el doc:

```
POST .../documents/alerts
{ "fields": {
    "deviceId":  { "stringValue": "DEVICE_ID" },
    "timestamp": { "timestampValue": "..." },
    "location":  { "mapValue": { ... } },
    "photoUrl":  { "stringValue": "https://..." },
    "audioUrl":  { "stringValue": "https://..." },
    "seen":      { "booleanValue": false }
}}
```

La PWA tiene un listener real-time y va a mostrar el banner instantáneamente.

## Encontrar el bastón (modo no vidente)

La pantalla del usuario no vidente tiene como acción principal **hacer sonar el
bastón**, no el SOS. El motivo es que el SOS de la app era redundante o
directamente incorrecto:

- con el bastón en la mano, el **botón físico** es más rápido y además dispara
  la foto y el audio del ESP32-CAM;
- sin el bastón, la app mandaba `device.location`, o sea la posición **del
  bastón**, no la del usuario, que es justo el caso en que se usaría.

Perder el bastón, en cambio, es un problema real y frecuente, y el hardware ya
lo resolvía: el buzzer del GPIO2.

Cómo funciona:

1. La app escribe `commands/{deviceId}` con un `ringToken` nuevo.
2. El bastón lee ese doc cada `RING_POLL_INTERVAL_MS` (5 s por defecto) — es el
   **único camino de lectura** del firmware, todo lo demás es escritura.
3. Si el token cambió, hace pitar el buzzer en grupos de 3 durante `ringSeconds`
   (tope de `RING_MAX_SECONDS`), sin bloquear el loop.
4. El bastón escribe `ackToken` de vuelta, y recién ahí la app le dice al
   usuario que **está sonando de verdad**. Sin ese eco la pantalla estaría
   afirmando algo que el usuario no puede verificar mirando.

Limitaciones que conviene tener presentes:

- **El GPS no sirve para esto.** Adentro de una casa no hay fix. Lo que
  encuentra el bastón es el sonido; el mapa solo sirve para "me lo dejé en otro
  edificio".
- **Si el bastón está sin batería o sin WiFi, no suena.** La app lo detecta por
  `isOnline` y lo dice, en vez de dejar al usuario esperando un pitido que no va
  a llegar. En ese caso ofrece la última ubicación conocida.
- **El poll bloquea el loop ~1 s** (handshake TLS), igual que el heartbeat.
  Mientras tanto no se mide obstáculos. `RING_POLL_INTERVAL_MS` es el botón para
  ajustar ese compromiso; una versión de producción usaría una conexión
  persistente (MQTT o Firestore Listen) en vez del poll.

El SOS sigue estando, como acción secundaria con hold-to-confirm de 2 s, pero
ahora manda la ubicación del **teléfono** (`navigator.geolocation`) y marca en
la alerta de dónde salió, para que la familia no salga a buscar al lugar
equivocado.

## Page Visibility — ahorro de cuota Firestore

Cuando el cuidador minimiza la pestaña o cambia de app, los listeners de Firestore
se cierran automáticamente (hook `usePageVisibility`). Al volver, se reanudan solos.
Esto reduce el consumo de la cuota gratuita de Firestore.

## Multi-cuidador

Varios familiares pueden ver el mismo bastón. Para autorizar a otro usuario:

1. El dueño obtiene el `uid` del nuevo cuidador (cuando este se registra).
2. Lo agrega al array `caregiverUids` del documento `devices/{deviceId}`
   (manualmente desde la consola por ahora — falta UI de invitación).
3. Le pasa el `deviceId` para que lo ingrese en la pantalla de pairing.

> **TODO sugerido (futuro):** UI de invitación con códigos QR/link mágico.

## Build y deploy

```bash
npm run build
npm run start          # corre en producción local
```

Para hosting, podés usar **Vercel** (recomendado para Next.js) o **Firebase Hosting**.
Acordate de configurar las variables de entorno en el panel del hosting.

## Notas para el capstone

- **Bluetooth**: la Web Bluetooth API solo funciona en Chrome/Edge (Android + desktop).
  Safari/iOS no la soporta — por eso hay un fallback de "ID manual". Para la demo
  recomiendo usar Chrome en Android.
- **Notificaciones push**: implementadas con la Web Notifications API (locales).
  Si querés FCM real (push aún con la app cerrada), necesitás un backend (Cloud
  Functions) que escuche cambios y envíe vía Admin SDK.
- **Iconos PWA**: ver `public/icons/README.md` para generarlos a partir de `icon.svg`.
