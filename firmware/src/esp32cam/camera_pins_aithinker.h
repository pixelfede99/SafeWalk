// ============================================================================
//  camera_pins_aithinker.h
//  Mapa de pines de la cámara OV2640 para el módulo ESP32-CAM AI-Thinker.
//  (Estos pines los ocupa la cámara: NO se pueden usar para otra cosa.)
//  Los pines LIBRES que quedan para el I2S del micrófono son 12/4/13
//  (ver config.h, sección BOARD_ESP32CAM).
// ============================================================================
#pragma once

#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22
