# Iconos de la PWA

Para que SafeWalk se instale como app necesitás dos PNGs en esta carpeta:

- `icon-192.png` (192x192)
- `icon-512.png` (512x512)

## Cómo generarlos desde `icon.svg`

**Opción A — Online (más fácil):**
1. Abrí https://realfavicongenerator.net/ o https://www.svgviewer.dev/svg-to-png
2. Subí `icon.svg`
3. Exportá en 192x192 y 512x512
4. Guardá los archivos acá con esos nombres exactos

**Opción B — Con ImageMagick (si lo tenés instalado):**
```bash
magick convert -background none -resize 192x192 icon.svg icon-192.png
magick convert -background none -resize 512x512 icon.svg icon-512.png
```

**Opción C — Con `sharp` desde Node:**
```js
import sharp from "sharp";
await sharp("icon.svg").resize(192, 192).png().toFile("icon-192.png");
await sharp("icon.svg").resize(512, 512).png().toFile("icon-512.png");
```

Hasta que no estén los PNGs la PWA igual funciona en el navegador, pero no se va a poder instalar como app en Android.
