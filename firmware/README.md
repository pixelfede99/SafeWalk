# SafeWalk — Firmware del bastón

Firmware del bastón inteligente **SafeWalk** (capstone de electrónica). Proyecto
**PlatformIO** (VS Code) para **dos placas ESP32** que trabajan juntas:

| Placa | Rol |
|---|---|
| **ESP32 DevKit v1** | Cerebro: GPS, HC-SR04 (obstáculos), MPU-6050 (caídas), motor, buzzer, botón, batería, WiFi/Firebase |
| **ESP32-CAM AI-Thinker** | Cámara OV2640 + micrófono INMP441 (audio) → MicroSD → Firebase Storage |

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
   │  Botón → emergencia      │                                │   → MicroSD (1-bit)    │
   │  GPS → ubicación         │                                │                        │
   │  Buzzer → feedback       │                                │                        │
   │  WiFi → Firestore        │   ambas suben a Firebase ───►  │  WiFi → Storage        │
   └──────────────────────────┘                                └────────────────────────┘
                 │                                                         │
                 └──────────────►   Firebase (Firestore + Storage)  ◄──────┘
```

**Reparto de responsabilidades (decisión de diseño):** cada placa sube a Storage
**el archivo que tiene físicamente**, por su propio WiFi, así el enlace entre
placas **solo transporta el `alertId` (texto)**, nunca los bytes (la foto pesa
decenas de KB y el audio ~480 KB; pasar eso por UART sería lentísimo).

- El **DevKit** crea el documento `alerts/{alertId}` con la ubicación (la alerta
  aparece **al instante** en el dashboard) y manda el `alertId` al ESP32-CAM.
- El **ESP32-CAM** saca la foto, graba el audio a su MicroSD, sube **ambos** a
  Storage y completa `photoUrl` + `audioUrl` en ese mismo documento (PATCH).

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
| MicroSD CLK / CMD / D0 | 14 / 15 / 2 | **SD_MMC modo 1-BIT** |
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
| `ALERT\|<alertId>\n` | DevKit → CAM | botón o caída | foto + audio 15s → Storage; PATCH `alerts/{alertId}` con `photoUrl`/`audioUrl` |

No hay hilo de retorno: el ESP32-CAM "responde" escribiendo las URLs en Firestore
(el dashboard las ve en tiempo real). El `alertId` lo genera el DevKit como
`{deviceId}_{timestampISO}` (con `:` reemplazados por `-`).

---

## Cómo compilar y flashear

Requisitos: **VS Code + extensión PlatformIO** (no Arduino IDE).

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
`test_audio_sd`, `test_trigger_rx` (ESP32-CAM).

---

## Simulación en Wokwi

`diagram.json` + `wokwi.toml` simulan **solo la parte simulable**: DevKit +
HC-SR04 + MPU-6050 + motor + buzzer + botón (y WiFi/Firebase, que Wokwi resuelve
por su gateway).

**No simulable en Wokwi** (probar en hardware real): cámara OV2640, audio I2S/SD
del ESP32-CAM, el GPS NEO-6M y el INT de caída del MPU. En la simulación el
firmware usa una ubicación por defecto (Obelisco) hasta tener fix real.

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
  escribir en Firestore/Storage (las reglas del repo exigen usuario autenticado).
- ⚠️ Por simplicidad de capstone, `FirebaseRest` usa `WiFiClientSecure::setInsecure()`
  (no valida el certificado del server). Para producción, fijá el root CA de Google.
