# ESP32-CAM: se reinicia por brownout al prender el WiFi

Síntoma (sesiones 4 y 5, octubre 2026): el serial muestra

```
=== SafeWalk ESP32-CAM ===
WiFi...
Brownout detector was triggered
```

y vuelve a empezar, varias veces por segundo. Nunca llega a `Login.. OK`, así que
no saca fotos ni sube nada.

## Qué ya está descartado

| Probado | Resultado | Conclusión |
|---|---|---|
| 5V del adaptador CP2102 | brownout (346 en 15 min) | — |
| 18650 → TP4056 → boost MT3608 | brownout | — |
| VIN del DevKit (USB de la PC) | brownout (3209 en 1 h) | **no es la fuente**: con tres fuentes distintas pasa igual |
| Firmware: WiFi antes que la cámara + potencia de TX baja | brownout | **no se arregla por software** |

Ojo: el 6/10 y el 13/10 esta misma CAM **sí conectaba** al WiFi. Algo cambió en
el camino de la alimentación (cables, protoboard, pin) o en la placa.

## Por qué pasa

Al prender el WiFi, el ESP32 calibra la radio y pide un pico de **~400–500 mA**
durante unos milisegundos. Si entre la fuente y el chip hay resistencia (dupont
finitos, una tira del protoboard floja, un cable largo), la tensión se cae en ese
pico, el detector de brownout la ve bajar de ~2,4 V en el riel de 3,3 V y resetea.
El regulador de la CAM (AMS1117) además necesita ~1 V de margen: con menos de
~4,4 V en el pin 5V, el riel de 3,3 V ya queda justo.

## Checklist, en orden (lo más probable primero)

1. **¿Entra por el pin "5V"?** En la AI-Thinker, mirando la placa con la cámara
   arriba, la columna izquierda es `5V, GND, IO12, IO13, IO15, IO14, IO2, IO4` y la
   derecha `3V3, IO16, IO0, GND, VCC, U0R, U0T, GND`. El pin **VCC** de la derecha
   **es una salida**, no una entrada: si la alimentación entra ahí, no anda.
2. **Cables directos, cortos, sin protoboard.** Un dupont hembra-hembra de la fuente
   al pin 5V y otro al GND de al lado. Las tiras del protoboard son la causa nº1
   de caídas con 500 mA. Si un dupont "baila" en el pin, cambialo.
3. **Capacitor.** Electrolítico de **470–1000 µF** (cualquier tensión ≥ 10 V) soldado
   o enchufado **en los mismos pines 5V/GND de la CAM**, pata corta (−) a GND. Es lo
   que cubre el pico mientras la fuente reacciona. Ideal sumar uno cerámico de
   100 nF en paralelo.
4. **Nada más colgado de la CAM** durante la prueba: micrófono desconectado, nada
   en IO12 (es pin de arranque) ni en IO0. Solo 5V, GND, U0R, U0T.
5. **Medir con el multímetro** (cuando haya uno):
   - En el pin **5V** de la CAM, *mientras* está en el loop de reinicios: tiene que
     dar **4,8–5,2 V**. Si da menos de 4,5 V, la caída está en los cables/fuente.
   - En el pin **3V3**: **3,2–3,4 V**. Si el 5V está bien pero el 3V3 da bajo o
     raro, el regulador de la CAM está dañado (puede pasar si alguna vez le
     entró más de 5 V, por ejemplo con el boost sin calibrar).
   - Salida del boost **sin carga**: 5,0 V (ajustar el trimpot girando mientras se
     mide; el sentido depende del módulo).
6. **Fuente buena y directa:** un cargador de celular de 5 V / 2 A con un cable
   USB cortado (rojo = 5V, negro = GND), directo a los pines. Unir los GND con el
   DevKit y el adaptador.

## Diagnóstico con firmware: `esp32cam_nobod`

Es el mismo firmware con el detector de brownout **apagado**. Sirve para saber
qué tan grave es la caída. **No es para el bastón final.**

```bash
cd firmware
pio run -e esp32cam_nobod
# flashear igual que esp32cam pero desde .pio/build/esp32cam_nobod (ver FLASHEO.md)
```

En el serial (9600) aparece `!!! DIAGNOSTICO: detector de brownout APAGADO`. Después:

- **Llega a `WiFi... OK` y `Login.. OK`** → las caídas son cortitas. Se arregla
  con el capacitor + cables cortos (puntos 2 y 3). Volvé a flashear `esp32cam`.
- **Se cuelga o reinicia igual** (`rst:0x...` sin la palabra brownout, o nada) →
  la tensión se derrumba de verdad: cables/protoboard, fuente, o el regulador
  de la CAM (medir el 3V3, punto 5).

## Si nada de esto funciona

Una ESP32-CAM AI-Thinker nueva cuesta poco y el firmware ya está listo. Antes de
comprar, conviene probar la placa **sola** (sin DevKit ni micrófono) con
`esp32cam_nobod`, cargador de 5 V / 2 A directo a los pines y el capacitor: si ni
así conecta al WiFi, es la placa.
