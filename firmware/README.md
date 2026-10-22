# SafeWalk — Firmware del bastón

Firmware del bastón inteligente **SafeWalk** (capstone de electrónica). Proyecto
**PlatformIO** (VS Code) para **dos placas ESP32** que trabajan juntas:

| Placa | Rol |
|---|---|
| **ESP32 DevKit v1** | Cerebro: GPS, HC-SR04 (obstáculos), MPU-6050 (caídas), motor, buzzer, botón, batería, WiFi/Firebase |
| **ESP32-CAM AI-Thinker** | Cámara OV2640 + micrófono INMP441 (audio) → PSRAM → Firestore (base64) |

La página web (raíz del repo) **solo lee** de Firestore. El bastón **escribe**
directo vía la REST API de Firebase.

---

## Índice rápido

- [Arquitectura](#arquitectura)
- [Conexiones (pinout)](#conexiones-pinout)
- [Revisiones técnicas](#revisiones-técnicas-importantes)
- [Protocolo entre las dos placas](#protocolo-entre-las-dos-placas)
- [Cómo compilar y flashear](#cómo-compilar-y-flashear)
- [Simulación en Wokwi](#simulación-en-wokwi)
- [Plan de testeo por etapas](#plan-de-testeo-por-etapas)
- [Credenciales y seguridad](#credenciales-y-seguridad)

---

## Arquitectura

```
   ┌──────────────────────────┐         UART 1 hilo            ┌────────────────────────┐
   │     ESP32 DevKit v1      │  GPIO13 ───────────────► GPIO3 │     ESP32-CAM          │
   │  (cerebro)               │     "ALERT|<alertId>"   (U0RX) │  (cámara + audio)      │
   │                          │                                │                        │
   │  HC-SR04 → motor (vibra) │                                │  OV2640 → foto         │
   │  MPU-6050 → caída (INT)  │                                │  INMP441 → audio .wav  │
   │  Botón → emergencia      │                                │   → PSRAM (sin SD)     │
   │  GPS → ubicación         │                                │                        │
   │  Buzzer → feedback       │                                │                        │
   │  WiFi → Firestore        │   ambas suben a Firebase ───►  │  WiFi → Firestore      │
   └──────────────────────────┘                                └────────────────────────┘
                 │                                                         │
                 └──────────────►   Firebase (solo Firestore)       ◄──────┘
```

**Reparto de responsabilidades (decisión de diseño):** cada placa sube **lo que
tiene físicamente**, por su propio WiFi, así el enlace entre placas **solo
transporta el `alertId` (texto)**, nunca los bytes (pasar una foto por UART sería
lentísimo).

- El **DevKit** crea el documento `alerts/{alertId}` con la ubicación (la alerta
  aparece **al instante** en el dashboard), manda el `alertId` al ESP32-CAM y
  llama a `/api/notify` (Vercel) para la push a la familia.
- El **ESP32-CAM** saca la foto y la sube **enseguida** a `photoUrl`; después graba
  6 s de audio en su PSRAM y lo sube a `audioUrl`. Los dos van como *data URL*
  base64 **dentro del doc de Firestore**: el plan gratis de Firebase no tiene
  Storage (tope: 1 MiB por doc; foto ~100 KB + audio ~130 KB).

### DevKit: dos núcleos

Cada request HTTPS a Firebase tarda 1–2 s (handshake TLS). Con todo en el `loop()`,
medido en el bastón real, el loop se trababa hasta **2,5 s** y quedaba bloqueado el
**25 %** del tiempo: caminando, hasta 3,5 m **sin detectar obstáculos**. Por eso:

- **Núcleo 1 (`loop`)**: sensores, motor, buzzer (no bloqueante), botón, GPS. Nunca
  toca la red. Medido: peor traba **26–68 ms**, 0 % bloqueado.
- **Núcleo 0 (`netTask`)**: heartbeat (que de paso trae el pedido de "sonar"), historial, alertas y push.
- Se comunican por una **cola de emergencias**, una copia del GPS con mutex y
  variables atómicas (pedido de "sonar", resultado de la alerta). Ningún objeto que
  no sea thread-safe (`FirebaseRest`, `TinyGPS`) se usa desde los dos lados.

Al terminar una alerta el buzzer avisa: **1 pitido largo = enviada; 5 cortitos =
falló** (volver a apretar). Mientras una alerta se manda, otra presión se ignora.

### Comandos por USB (DevKit, monitor serie a 115200)

| Comando | Qué hace |
|---|---|
| `SOS` | Dispara la emergencia igual que el botón (`trigger: "prueba"`) |
| `STATUS` | WiFi, Firebase, GPS, batería, MPU, trabas del loop, memoria |
| `RING` | Hace sonar el patrón de "encontrar el bastón" 5 s |
| `RINGTEST` | Escribe un pedido de "sonar" en `devices/` como la app: prueba el circuito completo (llega con el próximo heartbeat) |
| `SINWIFI` | Corta el WiFi 40 s, para probar el reintento de alertas y la reconexión |
| `SINHORA` | Pone el reloj en 1970, para probar que toma la hora del header `Date` si NTP no responde |
| `AYUDA` | Lista de comandos |

Si una alerta no se puede crear (sin WiFi, Firebase caído), queda **pendiente** y se
reintenta sola cada 10 s durante 10 min con la hora y ubicación del momento.

---

## Conexiones (pinout)

### ESP32 DevKit v1 (lógica 3.3V)

| Función | GPIO | Notas |
|---|---|---|
| HC-SR04 TRIG | 26 | salida |
| HC-SR04 ECHO | 25 | **divisor de tensión 5V→3.3V** |
| GPS RX (UART2) | 16 | ← TX del NEO-6M |
| GPS TX (UART2) | 17 | → RX del NEO-6M |
| MPU-6050 SDA | 21 | I2C |
| MPU-6050 SCL | 22 | I2C |
| MPU-6050 INT | 34 | input-only, caída por hardware |
| Motor vibración | 27 | vía **BC547** (+ diodo 1N4007 flyback) |
| Buzzer | 2 | vía **BC547** (ver revisiones) |
| Botón emergencia | 33 | `INPUT_PULLUP`, activo en LOW |
| **Disparo→CAM** | **13** | UART TX (antes GPIO12; ver revisiones) |
| **Batería ADC** | **35** | ADC1 + divisor 100k/100k (nuevo) |

> El **micrófono INMP441 ya NO va en el DevKit**: se movió al ESP32-CAM (ver abajo).
> Quedan libres GPIO14/15/32.

### ESP32-CAM AI-Thinker

| Función | GPIO | Notas |
|---|---|---|
| MicroSD CLK / CMD / D0 | 14 / 15 / 2 | **SD_MMC modo 1-BIT** (solo `test_audio_sd`; la alerta no usa SD) |
| INMP441 BCLK (SCK) | 12 | liberado en SD 1-bit |
| INMP441 WS (LRCK) | 4 | comparte el flash LED (parpadea al grabar) |
| INMP441 DATA (SD) | 13 | liberado en SD 1-bit |
| Disparo desde DevKit | 3 (U0RXD) | **desconectar para flashear por USB** |
| Cámara OV2640 | varios | pines fijos AI-Thinker (ver `camera_pins_aithinker.h`) |

INMP441: `VDD`→3.3V, `GND`→GND, `L/R`→GND (canal izquierdo).

---

## Revisiones técnicas (importantes)

1. **GPIO12 era riesgoso (strapping).** GPIO12 fija el voltaje de la flash en el
   boot; si queda en HIGH, la placa **no arranca**. Por eso el disparo se movió a
   **GPIO13** (libre, no strapping). GPIO12 queda sin usar en el DevKit.
2. **GPIO2 (buzzer) es strapping pero OK** porque lo maneja un transistor: el pin
   solo ve la base referida a GND, no lo fuerza a HIGH en el boot.
3. **SD del ESP32-CAM en 1-BIT** usa solo GPIO14/15/2 y **libera GPIO4/12/13** →
   ahí entra el I2S del micrófono. **No hay conflicto** con la SD.
4. **Buzzer 5V → necesita transistor.** Un buzzer activo tira ~20–30 mA, por
   encima de lo recomendado para un GPIO; va con **BC547** igual que el motor.
5. **Batería:** divisor **100k/100k** (Vbat/2) a **GPIO35** (ADC1, porque ADC2 no
   anda con WiFi). 4.2V→2.1V, seguro. Calibrar (el ADC del ESP32 no es lineal).

---

## Protocolo entre las dos placas

**Enlace:** UART de 1 hilo, **DevKit GPIO13 (TX) → ESP32-CAM GPIO3 (U0RXD)**,
`9600 8N1`, texto por línea.

| Mensaje | Dirección | Cuándo | Acción del receptor |
|---|---|---|---|
| `ALERT\|<alertId>\n` | DevKit → CAM | botón, caída o `SOS` | foto → PATCH `photoUrl`; audio 6 s → PATCH `audioUrl` (data URLs en `alerts/{alertId}`) |

No hay hilo de retorno: el ESP32-CAM "responde" escribiendo la foto y el audio en Firestore
(el dashboard las ve en tiempo real). El `alertId` lo genera el DevKit como
`{deviceId}_{timestampISO}` (con `:` reemplazados por `-`).

---

## Cómo compilar y flashear

> Para el paso a paso completo — cableado del adaptador USB-serie para el
> ESP32-CAM, alimentación, secuencia de GPIO0 y errores comunes — mirá
> **[FLASHEO.md](FLASHEO.md)**. Acá queda el resumen.

Requisitos: **VS Code + extensión PlatformIO** (no Arduino IDE), o
`pip install platformio` y usar la CLI.

```bash
# 1) credenciales (ver sección Seguridad)
cp include/secrets.h.example include/secrets.h   # y completalo

# 2) firmware principal del DevKit
pio run -e devkit -t upload -t monitor

# 3) firmware del ESP32-CAM
#    (GPIO0 a GND para entrar en modo flash; desconectá el hilo a GPIO3)
pio run -e esp32cam -t upload

# 4) un test puntual
pio run -e test_hcsr04 -t upload -t monitor
```

Lista de `env` de test: `test_buzzer`, `test_button`, `test_motor`,
`test_hcsr04`, `test_mpu6050`, `test_gps`, `test_battery`,
`test_wifi_firestore`, `test_trigger_tx` (DevKit) · `test_camera`,
`test_audio_sd`, `test_trigger_rx` (ESP32-CAM). Diagnóstico: `esp32cam_nobod`
(CAM con el detector de brownout apagado, ver [ALIMENTACION-CAM.md](ALIMENTACION-CAM.md)).

> La CAM con el adaptador CP2102 se flashea mejor con **esptool directo**: comando
> en [FLASHEO.md](FLASHEO.md).

---

## Simulación en Wokwi

`diagram.json` + `wokwi.toml` simulan **solo la parte simulable**: DevKit +
HC-SR04 + MPU-6050 + motor + buzzer + botón (y WiFi/Firebase, que Wokwi resuelve
por su gateway).

**No simulable en Wokwi** (probar en hardware real): cámara OV2640, audio I2S/SD
del ESP32-CAM, el GPS NEO-6M y el INT de caída del MPU. Sin GPS el firmware
manda la ubicación 0,0 con `gpsFix: false` y la app muestra "sin señal GPS".

```bash
pio run -e devkit        # genera el .bin/.elf que usa wokwi.toml
# luego: "Wokwi: Start Simulator" desde VS Code
```

---

## Plan de testeo por etapas

Orden recomendado para ir armando y probando el hardware:

**Fase A — DevKit (uno por uno):**
`test_buzzer` → `test_button` → `test_motor` → `test_hcsr04` →
`test_mpu6050` → `test_gps` → `test_battery` → `test_wifi_firestore` →
`test_trigger_tx`

**Fase B — ESP32-CAM (solo hardware real):**
`test_camera` → `test_audio_sd` → `test_trigger_rx`

**Fase C — Integración:** `devkit` + `esp32cam` juntos (flujo de emergencia completo).

---

## Credenciales y seguridad

- Las credenciales (WiFi + Firebase) van en **`include/secrets.h`**, que está en
  **`.gitignore`** y **no se versiona**. Usá `include/secrets.h.example` como plantilla.
- El firmware se autentica en Firebase con un **usuario email/password dedicado**
  del dispositivo (`signInWithPassword`) y usa el `idToken` como `Bearer` para
  escribir en Firestore (las reglas del repo exigen usuario autenticado). Si el
  refresco del token falla, vuelve a loguearse solo.
- ⚠️ Por simplicidad de capstone, `FirebaseRest` usa `WiFiClientSecure::setInsecure()`
  (no valida el certificado del server). Para producción, fijá el root CA de Google.
