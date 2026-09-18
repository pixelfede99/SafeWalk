# Flashear las dos placas — guía paso a paso

> Esta guía asume que ya tenés el repo clonado y PlatformIO instalado
> (`pip install platformio`). Si no, mirá `ESTADO-DEL-PROYECTO.md` en la raíz.
>
> **Todo esto se corre en TU PC**, con la placa enchufada por USB. No se puede
> hacer de forma remota: flashear necesita acceso físico al puerto serie.

---

## Antes que nada: `secrets.h`

Sin esto no compila ninguna de las dos placas.

```bash
cd firmware
cp include/secrets.h.example include/secrets.h   # una sola vez
```

Y completalo con el WiFi y la cuenta de Firebase. **No se sube al repo**
(está en `.gitignore`), así que si cambiaste de PC lo tenés que rehacer.

Recordá el gotcha del WiFi: el de un colegio o institución **no sirve** (portal
cautivo / filtro de DNS → el ESP32 da `DNS Failed` aunque conecte). Usá el
hotspot del celular saliendo por datos móviles.

---

## 1. ESP32 DevKit v1 (el cerebro)

Tiene USB propio, así que va directo con un cable de datos.

```bash
cd firmware
pio run -e devkit -t upload --upload-port COM3     # ajustá el puerto
pio run -e devkit -t monitor                       # 115200 baud
```

> **Puerto:** en Windows es `COM3`, `COM4`, etc. (Administrador de dispositivos).
> En Linux `/dev/ttyUSB0`. En Mac `/dev/cu.usbserial-*`. Si lo omitís,
> PlatformIO intenta detectarlo solo.

### Qué esperar en el monitor

```
=== SafeWalk DevKit (firmware principal) ===
WiFi... OK
NTP...  OK
Login.. OK
```

Si `Login..` dice FALLO, revisá la cuenta de Firebase en `secrets.h`.

### Este flasheo trae dos cosas nuevas

1. **"Encontrar el bastón"**: el bastón ahora lee `commands/{deviceId}` cada 5 s
   y hace pitar el buzzer cuando la app se lo pide. En el monitor vas a ver
   `[RING] sonando 30 s`.
2. **El arreglo del heartbeat**, que le borraba `ownerUid`, `caregiverUids` e
   `inviteCode` al documento del dispositivo cada 10 segundos.

⚠️ **Si el código de invitación del círculo ya se había perdido**, después de
flashear hay que volver a crearlo/emparejar desde la app. El arreglo evita que
vuelva a pasar, no recupera lo que ya se borró.

---

## 2. ESP32-CAM AI-Thinker (cámara + audio)

**No tiene USB.** Necesita un adaptador USB-serie (FTDI / CP2102 / CH340), que
es el que te habilita a flashearla.

### Cableado

| Adaptador USB-serie | ESP32-CAM | Nota |
|---|---|---|
| 5V | 5V | ver la advertencia de alimentación abajo |
| GND | GND | |
| **TX** | **U0R** (GPIO3) | cruzados: TX del adaptador va al RX de la placa |
| **RX** | **U0T** (GPIO1) | |
| — | **GPIO0 ↔ GND** | puente **solo para flashear**, se saca después |

Dos cosas que hay que desconectar sí o sí antes de flashear:

- **El hilo que viene del DevKit (GPIO13 → GPIO3 del CAM).** Comparte el mismo
  pin que el adaptador; si está conectado, el flasheo falla o sale basura.
- Nada conectado a **GPIO12**: es strapping, y si queda en HIGH al bootear la
  placa no arranca.

### ⚠️ Alimentación (la causa nº1 de que no ande)

El ESP32-CAM tira picos de corriente altos al encender la cámara y el WiFi.
Muchos adaptadores USB-serie baratos no los bancan, y la placa se reinicia sola
con un error de *brownout*.

Si ves `Brownout detector was triggered` o reinicios en loop:

- Alimentá el CAM con una fuente de 5V aparte (un cargador de celular sirve) y
  dejá del adaptador **solo TX, RX y GND**.
- **El GND tiene que estar unido entre las dos fuentes**, si no, no hay
  referencia común y no comunica.

Si tu adaptador tiene jumper de **3.3V / 5V**, en la mayoría ese jumper también
cambia el nivel lógico de TX/RX. Los GPIO del ESP32 **no toleran 5V**, así que
lo prolijo es ponerlo en 3.3V para la lógica y alimentar los 5V aparte.

### Secuencia de flasheo

```bash
cd firmware

# 1) GPIO0 a GND, adaptador enchufado
# 2) apretá RESET en la placa (o desconectá y reconectá la alimentación)
pio run -e esp32cam -t upload --upload-port COM4

# 3) SACÁ el puente de GPIO0 y apretá RESET otra vez
pio run -e esp32cam -t monitor     # OJO: este env monitorea a 9600 baud
```

El paso 3 no es opcional: con GPIO0 a masa la placa arranca siempre en modo
flasheo y no corre tu programa.

### Probá primero la cámara sola

Antes del firmware completo, conviene verificar que el cableado y la cámara
estén bien:

```bash
pio run -e test_camera -t upload -t monitor    # este va a 115200
```

Si la cámara no inicializa, casi siempre es el conector ribbon mal encastrado
(hay que levantar la traba negra, meter el flex derecho y bajar la traba).

### Para el audio

Hace falta una **microSD formateada en FAT32** puesta en la ranura, y el
micrófono INMP441 cableado así: VDD→**3.3V** (no 5V), GND→GND, L/R→GND,
WS→GPIO4, SCK→GPIO12, SD→GPIO13.

```bash
pio run -e test_audio_sd -t upload -t monitor
```

---

## 3. Probar "encontrar el bastón" de punta a punta

Con el DevKit ya flasheado y online:

1. **Primero el pitido solo**, sin WiFi de por medio:
   ```bash
   pio run -e test_ring -t upload -t monitor
   ```
   Escuchá si se oye **desde otra habitación, con la puerta cerrada, y con el
   bastón tapado con una campera o abajo de un sillón**. Así es como se pierde
   de verdad. Si no se escucha, el buzzer no alcanza y hay que cambiarlo por uno
   más potente — esa prueba decide si la función sirve o no.

2. **Después el ciclo completo**: volvé a flashear `devkit`, abrí la app en el
   celular con la cuenta del usuario no vidente, y tocá el botón grande.
   - El bastón tiene que empezar a pitar en **≤ 5 s** (es lo que tarda el poll).
   - La app tiene que pasar de *"Esperando que el bastón conteste..."* a
     *"El bastón recibió el pedido"*. Eso confirma que el `ackToken` volvió.
   - Tocá de nuevo para parar: el pitido tiene que cortarse en ≤ 5 s.

3. Si el bastón pita pero la app se queda en "Esperando", el problema está en la
   escritura de vuelta (`ringAck`), no en la lectura. Miralo en el monitor.

---

## Errores comunes

| Síntoma | Causa casi siempre |
|---|---|
| `Failed to connect to ESP32: Timed out waiting for packet header` | GPIO0 no está a GND, o falta apretar RESET justo antes de subir |
| `Brownout detector was triggered` | El adaptador no da corriente suficiente → alimentación aparte |
| Sale basura en el monitor | Baud equivocado (el env `esp32cam` es 9600, los tests 115200) |
| El CAM no bootea | Algo colgado de GPIO12, o el puente de GPIO0 quedó puesto |
| `DNS Failed` con WiFi conectado | Red con portal cautivo → usar hotspot por datos móviles |
| La primera compilación tarda muchísimo | Está bajando el toolchain (cientos de MB). Pasa una sola vez |

---

## Alternativa: flashear el DevKit desde el celular

Si no tenés la PC a mano, en `FLASH-celular/LEEME-offsets.txt` están los offsets
para flashear el DevKit por OTG con la app *ESP32_Flasher*. Los `.bin` no se
suben al repo porque al compilarlos con credenciales reales llevarían adentro la
contraseña del WiFi — hay que generarlos con `esptool merge_bin`.
