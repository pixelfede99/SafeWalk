# Safe Walk — diseño del bastón (hardware)

Modelo 3D **paramétrico** del bastón inteligente, generado con un script de Python para Blender.

## Concepto

- El bastón se mantiene **fino y redondo** casi en toda su longitud.
- Solo se **ensancha a un perfil cuadrado** en la zona del ESP32 DevKit (la placa más ancha).
- Los componentes están **repartidos a lo largo**, no amontonados en una caja.
- Se imprime en **segmentos** que se ensamblan con encastre macho/hembra, con un
  canal central para pasar el cableado.

## Distribución (de la punta al mango)

| Segmento | Componentes | Ø ext aprox |
|---|---|---|
| Punta | punta rodante | ~22 mm |
| Tubo bajo | solo cableado | ~22 mm |
| Ultrasónico | HC-SR04 (2 "ojos" al frente) | ~28 mm |
| GPS/GSM | módulo GPS/GSM + MT3608 | ~32 mm |
| **Pod ESP32** | **ESP32 DevKit v1 + ESP32-CAM + MPU6050** | **~36 mm (cuadrado)** |
| Batería | LiPo + TP4056 (USB de carga) | ~32 mm |
| Mango | buzzer + vibrador | ~25 mm |

> El **ESP32 DevKit v1 (28 mm de ancho)** es el que obliga a la zona gruesa.
> Si lo reemplazás por un módulo ESP32 pelado o un Wemos, esa zona baja a ~24 mm.

## Cómo generarlo

1. Instalá [Blender](https://www.blender.org/) (gratis).
2. Abrilo → pestaña **Scripting**.
3. **New** → pegá todo `safewalk_baston.py` → **Run Script** (o `Alt+P`).
4. Se crean todos los segmentos. Mové la cámara con la rueda / `MMB`.

### Para exportar a STL (imprimir)

En el script, cambiá:

```python
EXPORT_STL = True
```

y ajustá `EXPORT_DIR`. Cada segmento se exporta como `.stl` aparte.

## Parámetros que podés tocar

Todo arriba del script, en mm:

- `WALL` — espesor de pared.
- `CLEAR` — holgura alrededor de cada componente.
- `SPIGOT_OD`, `JOINT_LEN`, `FIT_CLEAR`, `CABLE_HOLE` — la junta entre segmentos.
- `EXPLODE` — separación visual entre segmentos (0 = ensamblado, >0 = vista explotada).
- `COMPONENTES` — medidas reales de cada placa (largo × ancho × alto).
- `SEGMENTOS` — orden, largo, forma (`round`/`square`) y aberturas de cada tramo.

La **cara frontal** (donde miran la cámara y el ultrasónico) es el eje **+Y**.

## Pendientes / ideas para iterar

- Postes/standoffs internos para fijar cada placa con tornillos.
- Tapa de acceso (registro) para llegar a la electrónica sin desarmar.
- Verificar el tipo exacto de LiPo (capacidad vs. picos del GSM ~2 A).
- Definir junta: encastre a presión vs. rosca vs. tornillo M3 lateral.
