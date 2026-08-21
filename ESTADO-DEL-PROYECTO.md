# SafeWalk — Estado del proyecto y continuidad

> **Para retomar en cualquier PC (o en una charla nueva con Claude):** leé este
> archivo primero. Resume dónde quedó todo, qué falta y cómo seguir.
> Última actualización: 2026-08-21.

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
| **DevKit flasheado por USB (COM3)** | ✅ Hecho, **pero con WiFi de relleno** |
| Dispositivo emparejado en la web (`SAFEWALK-DEVICE-001`) | ✅ Hecho |

### Por qué el bastón figura "Offline" en la app
La app lee el campo `isOnline` del documento `devices/SAFEWALK-DEVICE-001`. Ese campo
solo pasa a `true` cuando el **firmware escribe en Firebase**, y para eso necesita
**WiFi + login en Firebase**. El firmware flasheado todavía tiene el WiFi de relleno,
así que no conecta → sigue en `false` → la app muestra **Offline**. **No es un bug.**

---

## Lo que falta para dejarlo "En línea" (próximo paso)

Editar `firmware/include/secrets.h` (NO se versiona, está en `.gitignore`) con datos reales:

1. **WiFi** (líneas `WIFI_SSID` / `WIFI_PASSWORD`) — usar una red **2.4 GHz**
   (el ESP32 no toma 5 GHz). Un hotspot de celular sirve.
2. **Usuario de Firebase para el bastón** (`FB_DEVICE_EMAIL` / `FB_DEVICE_PASSWORD`):
   - En Firebase Console → **Authentication** → habilitar **Email/Password** en *Sign-in method*.
   - En **Users → Add user**, crear uno (ej. `baston@safewalk.local` + contraseña).
   - Poner ese mismo email/contraseña en `secrets.h`.
3. Recompilar y reflashear (ver comandos abajo). En segundos debería pasar a "En línea".

> El `FB_API_KEY`, `FB_PROJECT_ID` y `FB_STORAGE_BUCKET` ya están cargados (proyecto
> `safewalk-capstone`). El `SAFEWALK_DEVICE_ID` en `config.h` **debe coincidir exacto**
> con el ID que se pone en la web (`SAFEWALK-DEVICE-001`).

### Pendientes de hardware
- **ESP32-CAM:** no se puede flashear todavía (no tiene USB). Falta un **adaptador FTDI**
  o la plaquita **ESP32-CAM-MB**.
- **Micrófono INMP441:** mal soldado (pines cortos), a reconectar.
- **GPS NEO-6M:** LED apagado adentro es normal (no hay fix sin cielo). Si prende al mover,
  revisar **falso contacto en VCC/GND**. El GPS NO afecta el estado online.

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
- **Fix de compilación:** `FirebaseRest.cpp` incluye `../../include/config.h` con ruta
  relativa, porque al compilarse como librería el `include/` del proyecto no está en el CPPPATH.
- **GPIO12 del CAM** es "strapping": si algo lo deja en HIGH al boot, la placa no arranca.
- **GPIO3 del CAM** lo comparten el flasheo (USB) y el enlace del DevKit → desconectar uno u otro.
- PC lenta: la **primera compilación** baja el toolchain (~cientos de MB) y tarda; después queda cacheado.
