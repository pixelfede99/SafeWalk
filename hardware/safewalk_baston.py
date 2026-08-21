# -*- coding: utf-8 -*-
# =============================================================================
#  SAFE WALK - Generador parametrico del baston inteligente (Blender / bpy)
# =============================================================================
#  Como usarlo:
#    1) Abri Blender -> pestania "Scripting"
#    2) "New" para un script nuevo, pega TODO este archivo
#    3) Boton "Run Script" (o Alt+P)
#    4) Se generan todos los segmentos del baston, listos para revisar.
#       Para exportar a STL: poné EXPORT_STL = True y ajustá EXPORT_DIR.
#
#  Idea de diseño:
#    - El baston NO es una caja en el medio. Es un tubo que se mantiene fino
#      y redondo casi en toda su longitud, y SOLO se ensancha (perfil cuadrado)
#      en la zona donde vive el ESP32 DevKit, que es la placa mas ancha.
#    - Se imprime en SEGMENTOS (no entra 1,2 m en ninguna impresora).
#      Cada segmento termina abajo en un "macho" (spigot) y arriba en una
#      "hembra" (socket) para encastrar el siguiente. Por el centro pasa un
#      agujero para el cableado.
#    - Cada dimension importante sale de las medidas reales de los componentes.
#
#  Todo esta en MILIMETROS. (En Blender 1 unidad = 1 m, pero trabajamos en mm
#  y al final escalamos / o exportamos en mm; STL exporta los numeros tal cual.)
# =============================================================================

import bpy
import bmesh
from mathutils import Vector

# -----------------------------------------------------------------------------
#  PARAMETROS GLOBALES  (toca estos numeros para ajustar todo)
# -----------------------------------------------------------------------------
WALL        = 2.5    # espesor de pared del tubo
CLEAR       = 1.5    # holgura alrededor de cada componente

# Junta entre segmentos (encastre macho/hembra)
SPIGOT_OD   = 16.0   # diametro exterior del macho
JOINT_LEN   = 15.0   # cuanto se mete un segmento en el otro
FIT_CLEAR   = 0.4    # holgura del encastre (para que entre impreso)
CABLE_HOLE  = 8.0    # diametro del canal central para los cables

ROUND_VERTS = 48     # resolucion de los tubos redondos
SQ_BEVEL    = 6.0    # radio de redondeo de las esquinas en zonas cuadradas

EXPLODE     = 25.0   # separacion visual entre segmentos (0 = ensamblado)
                     # poné >0 para ver la "vista explotada"

EXPORT_STL  = False
EXPORT_DIR  = r"C:\Users\agust\Documents\claude code SW\hardware\stl"

# -----------------------------------------------------------------------------
#  COMPONENTES  (medidas reales aprox, en mm: largo x ancho x alto)
#  'ancho' es lo que va ATRAVESADO en el tubo -> manda el diametro de la zona.
# -----------------------------------------------------------------------------
COMPONENTES = {
    "esp32_devkit": (52, 28, 13),
    "esp32_cam":    (40, 27, 6),
    "mpu6050":      (22, 16, 3),
    "mt3608":       (37, 17, 4),
    "tp4056":       (26, 17, 6),
    "gps_gsm":      (35, 25, 8),
    "hc_sr04":      (45, 20, 18),
    "buzzer":       (14, 14, 9),
    "vibrador":     (12, 12, 25),
    "lipo":         (50, 25, 11),   # LiPo "slim"; subí el ancho si usás otra
}

def ancho_max(*nombres):
    """Devuelve el ancho mayor entre los componentes dados."""
    return max(COMPONENTES[n][1] for n in nombres)

# -----------------------------------------------------------------------------
#  DEFINICION DE SEGMENTOS  (de la PUNTA hacia el MANGO, se apilan en +Z)
#    nombre   : identificador
#    largo    : largo del segmento en Z (mm)
#    forma    : 'round' (redondo) o 'square' (cuadrado redondeado)
#    across   : ancho interno necesario (mm). Si es None se usa el default fino.
#    feats    : lista de aberturas: 'cam', 'ultra', 'usb'
#    comps    : que componentes viven aca (solo informativo / BOM)
# -----------------------------------------------------------------------------
DEFAULT_ACROSS = 16.0   # zona fina (solo cableado)

SEGMENTOS = [
    dict(nombre="01_punta",      largo=60,  forma="round",  across=None,
         feats=[],            comps=["punta rodante (sin electronica)"]),
    dict(nombre="02_tubo_bajo",  largo=180, forma="round",  across=None,
         feats=[],            comps=["solo cableado interno"]),
    dict(nombre="03_ultrasonico",largo=80,  forma="round",  across=ancho_max("hc_sr04"),
         feats=["ultra"],     comps=["hc_sr04"]),
    dict(nombre="04_gps_gsm",    largo=95,  forma="round",  across=ancho_max("gps_gsm","mt3608"),
         feats=[],            comps=["gps_gsm","mt3608"]),
    dict(nombre="05_pod_esp32",  largo=120, forma="square", across=ancho_max("esp32_devkit","esp32_cam","mpu6050"),
         feats=["cam"],       comps=["esp32_devkit","esp32_cam","mpu6050"]),
    dict(nombre="06_bateria",    largo=95,  forma="round",  across=ancho_max("lipo","tp4056"),
         feats=["usb"],       comps=["lipo","tp4056"]),
    dict(nombre="07_mango",      largo=130, forma="round",  across=ancho_max("buzzer","vibrador"),
         feats=[],            comps=["buzzer","vibrador"]),
]

# =============================================================================
#  HELPERS DE GEOMETRIA
# =============================================================================

def _new_mesh_obj(name):
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob

def cilindro(name, diam, largo, z0, verts=ROUND_VERTS):
    """Cilindro macizo, base en z0, eje Z."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=diam/2.0,
                                         depth=largo, location=(0, 0, z0 + largo/2.0))
    ob = bpy.context.active_object
    ob.name = name
    return ob

def prisma_redondeado(name, lado, largo, z0, bevel=SQ_BEVEL):
    """Prisma de seccion cuadrada con esquinas redondeadas (eje Z)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, z0 + largo/2.0))
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (lado, lado, largo)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # redondear esquinas verticales con un bevel
    bev = ob.modifiers.new("bev", 'BEVEL')
    bev.width = min(bevel, lado/2.0 - 0.5)
    bev.segments = 6
    bev.limit_method = 'ANGLE'
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=bev.name)
    return ob

def boolean(target, cutter, op='DIFFERENCE'):
    """Aplica un boolean de cutter sobre target y borra el cutter."""
    m = target.modifiers.new("bool", 'BOOLEAN')
    m.operation = op
    m.object = cutter
    m.solver = 'EXACT'
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(cutter, do_unlink=True)

def unir(a, b):
    """Une el objeto b dentro de a (join)."""
    bpy.ops.object.select_all(action='DESELECT')
    a.select_set(True)
    b.select_set(True)
    bpy.context.view_layer.objects.active = a
    bpy.ops.object.join()
    return a

# =============================================================================
#  CONSTRUCCION DE UN SEGMENTO
# =============================================================================

def construir_segmento(seg, z0):
    nombre = seg["nombre"]
    largo  = seg["largo"]
    forma  = seg["forma"]
    across = seg["across"] if seg["across"] else DEFAULT_ACROSS

    # tamanio interior necesario y exterior resultante
    inner = across + 2*CLEAR
    # el interior nunca puede ser menor que el socket de la junta
    inner = max(inner, SPIGOT_OD + FIT_CLEAR + 1.0)
    outer = inner + 2*WALL

    # --- cuerpo exterior macizo ---
    if forma == "square":
        cuerpo = prisma_redondeado(nombre, outer, largo, z0)
        cutter_inner = prisma_redondeado(nombre+"_in", inner, largo + 4, z0 - 2)
    else:
        cuerpo = cilindro(nombre, outer, largo, z0)
        cutter_inner = cilindro(nombre+"_in", inner, largo + 4, z0 - 2)

    # --- hueco interior (tubo hueco, abierto arriba y abajo) ---
    boolean(cuerpo, cutter_inner)

    # --- MACHO (spigot) abajo: sobresale JOINT_LEN por debajo de z0 ---
    spig = cilindro(nombre+"_spig", SPIGOT_OD, JOINT_LEN, z0 - JOINT_LEN)
    # canal de cable a traves del macho
    chole = cilindro(nombre+"_ch", CABLE_HOLE, JOINT_LEN + 2, z0 - JOINT_LEN - 1)
    boolean(spig, chole)
    unir(cuerpo, spig)

    # --- HEMBRA (socket) arriba: ensancho el bore superior para recibir el macho
    socket = cilindro(nombre+"_sock", SPIGOT_OD + 2*FIT_CLEAR,
                      JOINT_LEN + 1, z0 + largo - JOINT_LEN)
    boolean(cuerpo, socket)

    # --- aberturas funcionales (cara frontal = +Y) ---
    if "cam" in seg["feats"]:
        # agujero para el lente de la ESP32-CAM
        cam = cilindro(nombre+"_cam", 10, outer, z0 + largo*0.6)
        cam.rotation_euler = (1.5708, 0, 0)         # apunta en -Y/+Y
        bpy.ops.object.transform_apply(rotation=True)
        boolean(cuerpo, cam)

    if "ultra" in seg["feats"]:
        # dos "ojos" del HC-SR04 mirando al frente, separados 26 mm
        for dx in (-13, 13):
            ojo = cilindro(nombre+"_eye", 16.2, outer, z0 + largo*0.5)
            ojo.location.x = dx
            ojo.rotation_euler = (1.5708, 0, 0)
            bpy.ops.object.transform_apply(location=True, rotation=True)
            boolean(cuerpo, ojo)

    if "usb" in seg["feats"]:
        # ranura para el puerto USB de carga (TP4056) en la cara +X
        bpy.ops.mesh.primitive_cube_add(size=1, location=(outer/2, 0, z0 + largo*0.5))
        usb = bpy.context.active_object
        usb.scale = (outer, 13, 7)
        bpy.ops.object.transform_apply(scale=True)
        boolean(cuerpo, usb)

    cuerpo.name = nombre
    return cuerpo, outer

# =============================================================================
#  BUILD PRINCIPAL
# =============================================================================

def limpiar_escena():
    # Borrar objetos directamente por la API de datos (independiente de version)
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for blk in (bpy.data.meshes, bpy.data.objects):
        for d in list(blk):
            if d.users == 0:
                blk.remove(d)

def main():
    limpiar_escena()

    z = 0.0
    total = 0.0
    print("\n=== SAFE WALK - baston por segmentos ===")
    print(f"{'segmento':<16}{'largo':>7}{'Ø ext':>8}  componentes")
    for seg in SEGMENTOS:
        ob, outer = construir_segmento(seg, z)
        print(f"{seg['nombre']:<16}{seg['largo']:>6}mm{outer:>6.1f}mm  "
              + ", ".join(seg["comps"]))
        total += seg["largo"]
        z += seg["largo"] + EXPLODE

    print("-"*60)
    print(f"LARGO TOTAL ensamblado: {total:.0f} mm  (~{total/10:.0f} cm)")
    print(f"Segmentos: {len(SEGMENTOS)}  |  Pared: {WALL}mm  |  Canal cable: {CABLE_HOLE}mm")
    print("Cara frontal (camara/ultrasonico) = eje +Y\n")

    if EXPORT_STL:
        import os
        os.makedirs(EXPORT_DIR, exist_ok=True)
        for ob in bpy.context.scene.objects:
            bpy.ops.object.select_all(action='DESELECT')
            ob.select_set(True)
            bpy.context.view_layer.objects.active = ob
            path = os.path.join(EXPORT_DIR, ob.name + ".stl")
            # Blender 4.2+ usa wm.stl_export; versiones viejas export_mesh.stl
            if hasattr(bpy.ops.wm, "stl_export"):
                bpy.ops.wm.stl_export(filepath=path, export_selected_objects=True)
            else:
                bpy.ops.export_mesh.stl(filepath=path, use_selection=True)
            print("STL ->", path)

    bpy.ops.object.select_all(action='DESELECT')

main()
