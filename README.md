# SafeWalk

PWA para el bastón inteligente **SafeWalk** — proyecto capstone de electrónica.

La página **solo lee** datos del bastón y muestra alertas. El ESP32 escribe en
Firestore directamente vía la REST API de Firebase, esta app no controla el bastón.

## Stack

- **Next.js 14** (App Router) + **TypeScript** + **Tailwind CSS**
- **Firebase** en plan **gratis (Spark)**: Auth (email/password) y Firestore (real-time).
  **Sin Storage ni Cloud Functions** (exigen el plan pago): la foto y el audio de las
  alertas viajan como *data URL* base64 dentro del doc de la alerta.
- **Push con la app cerrada**: ruta `/api/notify` en **Vercel** (firebase-admin + FCM),
  también gratis.
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
│   ├── account/           # perfil, círculos, códigos de invitación, prueba de push
│   ├── api/notify/        # push FCM a la familia (corre en Vercel)
│   └── page.tsx           # router según estado del usuario
├── components/            # Map, DevicePanel, AlertBanner, AlertLocationMap, PushTestCard, etc.
├── context/AuthContext.tsx
├── hooks/                 # usePageVisibility, useDevice, useAlerts
├── lib/                   # firebase, firebaseAdmin, auth, firestore, location, push, ...
└── types/                 # tipos compartidos
public/
├── manifest.json
├── sw.js                  # service worker (muestra las push con la app cerrada)
└── icons/                 # iconos PWA (ver icons/README.md)
firestore.rules            # reglas de seguridad para Firestore
storage.rules              # NO se usa (el plan gratis no tiene Storage)
firmware/                  # ESP32 DevKit + ESP32-CAM (ver firmware/README.md)
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
4. **Storage no hace falta** (y en el plan gratis no está): las fotos y audios van
   dentro de Firestore.
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

6. Subí las reglas de seguridad de Firestore: en la consola, **Firestore Database →
   Reglas**, pegá el contenido de `firestore.rules` y tocá **Publicar**. (O con la
   CLI: `firebase deploy --only firestore:rules`.) **Cada vez que cambie
   `firestore.rules` hay que volver a publicarlas**: el archivo del repo no se aplica solo.

7. Para las **push con la app cerrada**: `NEXT_PUBLIC_FIREBASE_VAPID_KEY` (Cloud
   Messaging → Web Push certificates) y, solo en el servidor,
   `FIREBASE_SERVICE_ACCOUNT` (Cuentas de servicio → Generar nueva clave privada, el
   JSON completo). Ver `.env.local.example`. En Vercel van en Settings → Environment
   Variables, y después hay que hacer **Redeploy**. Para verificar:
   `GET /api/notify` tiene que responder `{"configured":true}`, y en la app,
   **Mi cuenta → Notificaciones → Probar notificación**.

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
  - location: { lat, lng }   # 0,0 = el bastón nunca tuvo GPS (no hay ubicación)
  - gpsFix?: boolean         # false = location es la ÚLTIMA posición conocida
  - speed: number
  - bluetoothId?: string
  - inviteCode?: string      # código para que otro familiar se una al círculo

locations/{deviceId}/history/{auto-id}
  - lat: number
  - lng: number
  - timestamp: timestamp

alerts/{alertId}
  - deviceId: string
  - timestamp: timestamp
  - location: { lat, lng }
  - photoUrl: string  # "data:image/jpeg;base64,..." (la completa el ESP32-CAM)
  - audioUrl: string  # "data:audio/wav;base64,..." (6 s a 8 kHz; vacío sin micrófono)
  - seen: boolean
  - seenBy?: string[]
  - source?: "device" | "pwa_sos"           # boton fisico del baston vs SOS de la app
  - trigger?: "boton" | "caida" | "prueba"  # que la disparo en el baston
  - locationSource?: "device"|"device_last"|"phone"|"unknown"   # de donde salio `location`
  - notified?: boolean                      # lo marca /api/notify (evita push repetida)

commands/{deviceId}          # ordenes de la APP -> BASTON (unico camino de ida)
  - ringToken: number        # nonce; el baston actua cuando cambia
  - ringSeconds: number      # cuanto sonar (0 = parar)
  - requestedBy: string      # uid de quien lo pidio
  - updatedAt: timestamp
  - ackToken?: number        # eco que escribe el BASTON al ejecutar la orden
```

> **Por qué `commands/` es una colección aparte y no un campo de `devices/`:**
> el heartbeat del ESP32 reescribe `devices/{deviceId}` cada 10 s. Al principio lo
> hacía con un PATCH **sin `updateMask`**, que en la REST API de Firestore reemplaza
> el documento entero (hoy usa `updateMask`, pero la separación sigue siendo más
> segura). Además así el bastón lee un documento chico.

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

### Alerta (botón físico o caída)

1. El **DevKit** crea `alerts/{deviceId}_{timestamp}` con la ubicación, `trigger`,
   `locationSource` y `photoUrl`/`audioUrl` vacíos.
2. Le manda `ALERT|<alertId>` al **ESP32-CAM** por un cable (UART).
3. Llama a `POST /api/notify` (Vercel) con su idToken → push a toda la familia.
4. El **ESP32-CAM** saca la foto y la sube **enseguida** a `photoUrl` (data URL
   base64); después graba 6 s de audio en su PSRAM y lo sube a `audioUrl`.

```
PATCH .../documents/alerts/ALERT_ID?updateMask.fieldPaths=photoUrl
{ "fields": { "photoUrl": { "stringValue": "data:image/jpeg;base64,..." } } }
```

La PWA tiene un listener real-time: el banner aparece al instante y la foto se
completa sola cuando llega. Límite a tener en cuenta: un doc de Firestore puede
pesar como mucho 1 MiB (foto ~100 KB + audio ~130 KB en base64 entran de sobra).

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

### Un solo gesto para toda la pantalla

El área central entera es **un botón**: el usuario no tiene que acertarle a
nada, toca donde sea.

| Gesto | Qué hace |
|---|---|
| Tocar | Hace sonar el bastón (o para el pitido si ya está sonando) |
| Mantener 3 s | SOS |

Detalles que no son cosméticos:

- **Un "mantener" contiene un tap.** Al soltar siempre llega el evento de
  release, así que después de disparar el SOS hay que suprimir el tap a mano; si
  no, soltar el dedo haría sonar el bastón encima de la emergencia.
- **3 segundos, no 500 ms.** El botón ocupa toda la pantalla: un roce largo no
  puede terminar mandándole una emergencia a la familia.
- **A los 600 ms el bastón avisa por voz** ("seguí apretando para pedir ayuda,
  soltá para hacer sonar el bastón") y vibra una vez por segundo. Sin eso, el
  usuario no tiene forma de saber en qué parte del gesto está.
- **Los navegadores móviles emulan eventos de mouse después de un touch.** Sin
  una bandera que los ignore, un solo toque llegaba dos veces y el bastón
  empezaba a sonar y se paraba solo al instante.

### Cómo funciona el "sonar"

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
- **El poll ya no traba la detección de obstáculos.** Toda la red del DevKit corre
  en una tarea propia en el núcleo 0; el loop de sensores del núcleo 1 no espera a
  Firebase (medido: peor traba 26–68 ms, antes 2,5 s). El costo del poll es solo
  de red/batería; una versión de producción usaría una conexión persistente (MQTT
  o Firestore Listen) en vez del poll.

El SOS sigue estando, como acción secundaria con hold-to-confirm de 3 s, pero
ahora manda la ubicación del **teléfono** (`navigator.geolocation`) y marca en
la alerta de dónde salió, para que la familia no salga a buscar al lugar
equivocado.

## Page Visibility — ahorro de cuota Firestore

Cuando el cuidador minimiza la pestaña o cambia de app, los listeners de Firestore
se cierran automáticamente (hook `usePageVisibility`). Al volver, se reanudan solos.
Esto reduce el consumo de la cuota gratuita de Firestore.

## Multi-cuidador

Varios familiares pueden ver el mismo bastón. En **Mi cuenta → Mis círculos**, el
dueño ve el **código de invitación** de 6 letras (lo puede copiar o regenerar); el
otro familiar entra en **Unirme a otro círculo** y lo pega. Queda agregado a
`caregiverUids` y recibe las alertas y las push.

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
- **Notificaciones push**: FCM real (llegan con la app cerrada) sin Cloud Functions:
  el que crea la alerta (el DevKit o la PWA) llama a `/api/notify` en Vercel, que
  usa firebase-admin. Necesita `FIREBASE_SERVICE_ACCOUNT` cargada en Vercel.
- **Iconos PWA**: ver `public/icons/README.md` para generarlos a partir de `icon.svg`.
