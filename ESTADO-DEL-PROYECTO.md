# SafeWalk — Estado del proyecto y continuidad

> **Para retomar en cualquier PC (o en una charla nueva con Claude):** leé este
> archivo primero. Resume dónde quedó todo, qué falta y cómo seguir.
> Última actualización: 2026-09-08 (sesión 3: "encontrar el bastón" + SOS arreglado).

---

## Resumen en 30 segundos

- **Bastón inteligente** para personas ciegas. Dos placas ESP32 (DevKit v1 = cerebro,
  ESP32-CAM = cámara/audio) + un **dashboard web** (Next.js/Firebase) que la familia
  usa para ver ubicación, batería y alertas.
- **El código está completo.** Lo que falta es **configuración y armado de hardware**,
  no programación.
- Repo: https://github.com/pixelfede99/SafeWalk (rama `main`).

---

## Estado actual (qué está hecho)

| Ítem | Estado |
|---|---|
| Firmware DevKit (`firmware/src/devkit/devkit_main.cpp`) | ✅ Completo y **compila** |
| Firmware ESP32-CAM (`firmware/src/esp32cam/esp32cam_main.cpp`) | ✅ Completo (falta poder flashearlo) |
| Librería `FirebaseRest` | ✅ Completa (con fix de include para que compile) |
| Dashboard web | ✅ Completo |
| "Encontrar el bastón" (web + firmware) | ✅ Código completo, **falta probarlo en el bastón** |
| **DevKit flasheado por USB (COM3)** | ✅ Hecho, **con credenciales reales** |
| Dispositivo emparejado en la web (`SAFEWALK-DEVICE-001`) | ✅ Hecho |
| **Bastón "En línea" en la app** | ✅ **LOGRADO** (WiFi + login Firebase OK) |

### ✅ El bastón ya figura "En línea"
En la sesión 2 se completó `secrets.h` con el WiFi real y la cuenta de Firebase, se
arregló un bug del firmware (ver gotchas: *chunked-encoding*) y ahora el bastón
loguea y escribe en Firebase. El serial muestra `WiFi... OK / NTP... OK / Login.. OK`
y la app lo muestra **En línea** con batería y ubicación.

**Credenciales usadas (en `secrets.h`, NO versionado):** WiFi = hotspot del celular
(2.4 GHz); cuenta Firebase = la cuenta personal del usuario (cualquier usuario
autenticado sirve, las reglas demo permiten escribir a todo usuario logueado).

---

## Sesión 3: la pantalla del usuario no vidente cambió de función

**Qué se cambió y por qué.** El botón principal del modo no vidente era un SOS, y
ese SOS no servía para nada en ninguno de los dos escenarios posibles:

- **Con el bastón en la mano:** el botón FÍSICO del bastón es más rápido y
  además dispara la foto y el audio del ESP32-CAM. El de la app hacía menos.
- **Sin el bastón:** mandaba `device.location`, o sea la posición del BASTÓN, no
  la del usuario — justo el caso en el que se usaría. Y si el bastón estaba
  offline, ni siquiera mandaba la alerta.

Perder el bastón, en cambio, es un problema real y frecuente, y el hardware ya
lo resolvía (el buzzer del GPIO2). Así que:

- **Acción principal ahora: "SONAR BASTÓN"** (un tap, sin mantener apretado:
  hacerlo sonar no rompe nada y se corta solo).
- **El SOS queda como acción secundaria** con hold de 2 s, y ahora manda la
  ubicación del TELÉFONO (`navigator.geolocation`). La alerta guarda de dónde
  salió la ubicación y el dashboard lo muestra, para que la familia no salga a
  buscar al lugar equivocado.

**Cómo funciona el "sonar":** la app escribe `commands/{deviceId}` con un
`ringToken` nuevo → el bastón lee ese doc cada 5 s (es el **único camino de
lectura** del firmware; hubo que agregarle `firestoreGet()` a `FirebaseRest`,
que solo sabía escribir) → pita en grupos de 3 → escribe `ackToken` de vuelta
para que la app pueda confirmarle al usuario que el bastón SÍ recibió la orden.

### ⚠️ Lo que falta probar en el hardware (no se pudo verificar por software)

1. **Que el pitido se escuche de verdad**, que es la función entera. Usá el test
   nuevo: `pio run -e test_ring -t upload -t monitor`. Probalo **desde otra
   habitación, con la puerta cerrada, y con el bastón tapado con una campera o
   abajo de un sillón**, que es como se pierde en la vida real. Si no se
   escucha, el buzzer de 5V por transistor no alcanza y hay que pensar en uno
   más potente: **ahí se cae la función**, así que probalo antes que nada.
2. **Que el ciclo completo ande:** apretar "SONAR BASTÓN" en el celular y que el
   bastón pite en ≤ 5 s, y que la app pase de "Esperando que el bastón
   conteste..." a "El bastón recibió el pedido" (eso confirma que el `ackToken`
   vuelve).
3. **Que el GET a Firestore funcione** (`firestoreGet` manda un GET con
   `Content-Length: 0`; Google debería aceptarlo, pero no se pudo probar contra
   Firestore real).

### Compromiso que conviene tener en la cabeza

El poll abre una conexión TLS nueva cada 5 s y **bloquea el loop ~1 s**, igual
que el heartbeat. Mientras tanto **no se mide obstáculos**. Si al probarlo el
bastón se siente "lento" para avisar obstáculos, subí `RING_POLL_INTERVAL_MS`
en `config.h` (a costa de que tarde más en empezar a sonar). La solución de
verdad sería una conexión persistente (MQTT o Firestore Listen) en vez del poll,
pero eso es bastante más firmware.

---

## Estado del testeo de hardware (sesión 2)

| Componente | Estado | Notas |
|---|---|---|
| **HC-SR04 (ultrasónico)** | ✅ Anda perfecto | Mide 1 cm a ~1 m, estable. Divisor del ECHO OK. |
| **Buzzer** | ✅ Anda perfecto | GPIO2 vía BC547. Pita más rápido cuanto más cerca. |
| **Motor vibración** | ⚠️ **En debug** | Ver abajo. |
| **GPS NEO-6M** | ⚠️ Cableado OK, sin fix | `chars recibidos` suben (UART OK), `sats:0`. **Falta cielo** (probar en ventana/afuera, cold start 1-15 min). |
| Batería | — | 0% correcto (sin batería conectada). |

### 🔧 Debug del MOTOR (donde quedó la sesión 2)
- El motor gira **directo** (+/–) y también con el **puente** (1kΩ a 3.3V forzando el
  transistor ON) → **el transistor BC547 y el motor están OK**.
- **Bug encontrado y resuelto:** el diodo **1N4007 estaba al revés** (cortocircuitaba
  el motor). Va con la **banda blanca (cátodo) hacia el + del motor**.
- **Problema que quedó abierto:** manejado desde **GPIO27** el motor no responde
  (anduvo "medio raro" al principio y después nada), aunque el puente a 3.3V sí anda.
  **Sospecha nº1: cable dupont de GPIO27→1kΩ roto por dentro.** PRÓXIMO PASO:
  1. Cambiar ese cable por otro nuevo; reasentar todo; probar con la mano quieta a
     ~5-10 cm del sensor (el motor solo vibra si hay algo a <150 cm).
  2. Si sigue: flashear un test que prenda/apague GPIO27 cada 1s con `digitalWrite`
     (sin PWM ni sensor). Si tampoco anda pero el puente sí → GPIO27 dañado, mover el
     motor a otro pin (ej. GPIO14, libre) en `config.h` (`PIN_MOTOR`).

### Otros pendientes de hardware
- **ESP32-CAM:** ✅ **destrabado** — ya hay un adaptador USB-serie. Falta hacerlo:
  el cableado y la secuencia están en `firmware/FLASHEO.md`.
- **Micrófono INMP441:** va en el **ESP32-CAM** (no en el DevKit): VDD→3.3V, GND, L/R→GND,
  WS→GPIO4, SCK→GPIO12, SD→GPIO13.
- **Alimentación:** comprar un **TP4056 CON protección** (DW01+FS8205, con pads OUT+/OUT−
  separados de B+/B−); el básico de 4 pines no protege la batería. **MT3608:** ajustar el
  trimpot a **5.0V midiendo con multímetro ANTES** de conectarlo al ESP32.

---

## ⏭️ Lo próximo, en orden (cuando tengas el cable y la placa)

Guía completa con cableado y errores comunes: **`firmware/FLASHEO.md`**.

1. **`pio run -e test_ring -t upload -t monitor`** — escuchá el pitido desde otra
   habitación, con la puerta cerrada y el bastón tapado con ropa. **Esta prueba
   decide si la función sirve.** Si no se escucha, hay que cambiar el buzzer.
2. **`pio run -e devkit -t upload`** — deja el bastón con "encontrar el bastón" y
   con el arreglo del heartbeat. Si el `inviteCode` ya se había perdido, hay que
   rehacer el emparejamiento desde la app (el arreglo evita que vuelva a pasar,
   no recupera lo borrado).
3. **Ciclo completo**: tocar el botón en la app y que el bastón pite en ≤ 5 s, y
   que la pantalla pase a "El bastón recibió el pedido".
4. **ESP32-CAM**: con el adaptador USB-serie, primero `test_camera` y después
   `esp32cam`. Acordate de desconectar el hilo del DevKit a GPIO3 y de poner
   GPIO0 a GND para flashear.

---

## Cómo compilar y flashear

Requisitos: Python + PlatformIO Core (`pip install platformio`). NO hace falta VS Code.

```bash
cd firmware
# 1) credenciales (una sola vez): copiar la plantilla y completarla
cp include/secrets.h.example include/secrets.h

# 2) firmware principal del DevKit -> flashear por USB (ajustar el puerto)
pio run -e devkit -t upload --upload-port COM3

# 3) ver el monitor serie (115200 baud)
pio run -e devkit -t monitor

# 4) tests individuales (env: test_hcsr04, test_gps, test_motor, test_button, ...)
pio run -e test_gps -t upload -t monitor

# 5) test COMBINADO obstáculo (HC-SR04 + motor + buzzer juntos, sin WiFi)
pio run -e test_obstacle -t upload -t monitor

# 6) test del pitido de "encontrar el bastón" (sin WiFi): probalo desde otra
#    habitación y con el bastón tapado, que es como se pierde de verdad
pio run -e test_ring -t upload -t monitor
```

**Flashear desde el celular (sin cable de datos a la PC):** ver `firmware/FLASH-celular/`
(genero los `.bin` combinados con esptool `merge_bin` y se flashean con la app
*ESP32_Flasher* en offset `0x0`). Los `.bin` NO se suben a git (contendrían la
contraseña del WiFi al compilar con credenciales reales).

---

## Puesta a punto en una PC nueva

1. Instalar **git**, **Python** y **PlatformIO** (`pip install platformio`).
2. `git clone https://github.com/pixelfede99/SafeWalk.git`
3. `cd SafeWalk/firmware && cp include/secrets.h.example include/secrets.h` y completar.
4. Para el dashboard web: en la raíz, `npm install` y `npm run dev`.
5. Leer este archivo y el `firmware/README.md` (tiene pinout y detalles).

---

## Cableado (para verificar en el protoboard)

### ESP32 DevKit v1
| Componente | Pin | Extra |
|---|---|---|
| HC-SR04 TRIG / ECHO | 26 / 25 | ECHO con **divisor 1kΩ/2kΩ** (5V→3.3V) |
| Motor vibración | 27 | **BC547** (R base 1kΩ) + **1N4007**. Alimentar a **3.3V** |
| Buzzer | 2 | **BC547** (R base 1kΩ) |
| Botón | 33 | a GND, usa pull-up interno |
| Batería (ADC) | 35 | **divisor 100kΩ/100kΩ** |
| MPU-6050 SDA/SCL/INT | 21 / 22 / 34 | I2C, AD0→GND |
| GPS TX→ / RX← | 16 / 17 | cruzados; GPS a 3.3V/5V |
| Enlace → ESP32-CAM | 13 | va al GPIO3 del CAM |
| Desacople | — | 470–1000µF en 5V + 100nF |

### ESP32-CAM AI-Thinker
| Componente | Pin | Notas |
|---|---|---|
| Cámara OV2640 | ribbon | solo encastrada |
| MicroSD | ranura | FAT32, modo 1-bit |
| INMP441 SCK/WS/SD | 12 / 4 / 13 | VDD a **3.3V** (no 5V) |
| Enlace ← DevKit | 3 (U0RXD) | desconectar para flashear por USB |

**GND de las dos placas siempre unido.**

---

## Decisiones y gotchas (para no repetir errores)

- **Motor a 3.3V** (probado, anda mejor que a 5V; muchos motores de vibración son 3V).
- **Diodo flyback del motor:** la **banda blanca (cátodo) va al + del motor**. Al revés
  cortocircuita y el motor no gira (nos pasó y costó encontrarlo).
- **Bug del login a Firebase (chunked-encoding) — RESUELTO:** el lector HTTP de
  `FirebaseRest.cpp` no decodificaba `Transfer-Encoding: chunked` (lo que usa Google),
  así que la respuesta del login llegaba con los marcadores de tamaño mezclados y el
  token no se parseaba → `Login.. FALLO` → escrituras `403 PERMISSION_DENIED`. Se agregó
  `readHttpResponse()` que decodifica chunked/Content-Length y se aplicó a login,
  Firestore y Storage. Sin esto el bastón nunca pasa a online.
- **WiFi de colegio/institución no sirve:** tienen portal cautivo/filtro DNS → el ESP32
  da `DNS Failed` aunque conecte. Compartir por **datos móviles** (apagar el WiFi del
  celular para que el hotspot salga por 4G/5G).
- **`isOnline` solo se escribe en `true`:** el firmware lo manda `true` en cada
  heartbeat y nadie lo pone nunca en `false`, así que un bastón apagado seguía
  figurando "CONECTADO" en la app para siempre. No tiene arreglo del lado del
  firmware (un bastón apagado no puede avisar que se apagó): la señal de que
  está muerto es la AUSENCIA de heartbeat. Ahora la app lo deduce de `lastSeen`
  (`src/lib/device-status.ts`, 35 s de tolerancia = 3.5 heartbeats). Hace falta
  un tick de reloj (`useNow`) porque si no, no llega ningún snapshot que dispare
  el re-render — justamente porque está desconectado. **Si cambiás
  `HEARTBEAT_INTERVAL_MS` en config.h, cambiá `OFFLINE_AFTER_MS` también.**
- **PATCH sin `updateMask` REEMPLAZA el documento entero (Firestore REST):** el
  heartbeat usaba `firestoreSet()` sobre `devices/{id}`, que hace justamente eso,
  así que cada 10 s le borraba al documento los campos que solo escribe la app:
  `ownerUid`, `caregiverUids`, `name` e `inviteCode`. Efecto práctico: el código
  de invitación dejaba de existir apenas el bastón se ponía online, y con él el
  emparejamiento de familiares. Ahora va con `firestoreUpdate()` + updateMask.
  **Ojo:** hace falta reflashear para que el arreglo tenga efecto, y si ya se
  perdieron esos campos hay que volver a crear/emparejar el círculo desde la app.
  `firestoreSet()` sigue siendo lo correcto para CREAR el doc de una alerta nueva.
- **Fix de compilación:** `FirebaseRest.cpp` incluye `../../include/config.h` con ruta
  relativa, porque al compilarse como librería el `include/` del proyecto no está en el CPPPATH.
- **GPIO12 del CAM** es "strapping": si algo lo deja en HIGH al boot, la placa no arranca.
- **GPIO3 del CAM** lo comparten el flasheo (USB) y el enlace del DevKit → desconectar uno u otro.
- PC lenta: la **primera compilación** baja el toolchain (~cientos de MB) y tarda; después queda cacheado.
