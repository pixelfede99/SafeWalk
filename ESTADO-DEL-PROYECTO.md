# SafeWalk — Estado del proyecto y continuidad

> **Para retomar en cualquier PC (o en una charla nueva con Claude):** leé este
> archivo primero. Resume dónde quedó todo, qué falta y cómo seguir.
> Última actualización: 2026-08-21 (sesión 2: bastón ya ONLINE + testeo de hardware).

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
- **ESP32-CAM:** no se puede flashear todavía (no tiene USB). Falta un **adaptador FTDI**
  o la plaquita **ESP32-CAM-MB**.
- **Micrófono INMP441:** va en el **ESP32-CAM** (no en el DevKit): VDD→3.3V, GND, L/R→GND,
  WS→GPIO4, SCK→GPIO12, SD→GPIO13.
- **Alimentación:** comprar un **TP4056 CON protección** (DW01+FS8205, con pads OUT+/OUT−
  separados de B+/B−); el básico de 4 pines no protege la batería. **MT3608:** ajustar el
  trimpot a **5.0V midiendo con multímetro ANTES** de conectarlo al ESP32.

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
- **Fix de compilación:** `FirebaseRest.cpp` incluye `../../include/config.h` con ruta
  relativa, porque al compilarse como librería el `include/` del proyecto no está en el CPPPATH.
- **GPIO12 del CAM** es "strapping": si algo lo deja en HIGH al boot, la placa no arranca.
- **GPIO3 del CAM** lo comparten el flasheo (USB) y el enlace del DevKit → desconectar uno u otro.
- PC lenta: la **primera compilación** baja el toolchain (~cientos de MB) y tarda; después queda cacheado.
