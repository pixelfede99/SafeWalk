// ============================================================================
//  TEST 10 - CAMARA OV2640   (corre en: ESP32-CAM AI-Thinker)   env: test_camera
//  ----------------------------------------------------------------------------
//  NO se puede simular en Wokwi. Solo hardware real.
//  Inicializa la cámara, saca una foto JPEG y muestra su tamaño por serial.
//
//  Esperado: "Foto OK - NNNN bytes" cada ~3s. Si falla el init, suele ser por
//  alimentación insuficiente (la OV2640 pide picos de corriente: usá 5V buenos)
//  o el cable/placa.
//
//  Recordá: para flashear el ESP32-CAM por USB-TTL, GPIO0 a GND al bootear, y
//  DESCONECTAR el hilo del DevKit que va a GPIO3 (U0RXD).
// ============================================================================
#include <Arduino.h>
#include "esp_camera.h"
#include "camera_pins_aithinker.h"

static bool initCamera() {
  camera_config_t c;
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer   = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM;  c.pin_d1 = Y3_GPIO_NUM;
  c.pin_d2 = Y4_GPIO_NUM;  c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM;  c.pin_d5 = Y7_GPIO_NUM;
  c.pin_d6 = Y8_GPIO_NUM;  c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM;  c.pin_pclk = PCLK_GPIO_NUM;
  c.pin_vsync = VSYNC_GPIO_NUM; c.pin_href = HREF_GPIO_NUM;
  c.pin_sccb_sda = SIOD_GPIO_NUM; c.pin_sccb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn = PWDN_GPIO_NUM;   c.pin_reset = RESET_GPIO_NUM;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;

  // Con PSRAM podemos usar resolución mayor y doble buffer.
  if (psramFound()) {
    c.frame_size = FRAMESIZE_SVGA;   // 800x600 (~30-50KB JPEG)
    c.jpeg_quality = 12;
    c.fb_count = 2;
    c.fb_location = CAMERA_FB_IN_PSRAM;
    c.grab_mode = CAMERA_GRAB_LATEST;
  } else {
    c.frame_size = FRAMESIZE_VGA;
    c.jpeg_quality = 15;
    c.fb_count = 1;
    c.fb_location = CAMERA_FB_IN_DRAM;
    c.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  }
  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) { Serial.printf("Camara init FALLO 0x%x\n", err); return false; }
  return true;
}

void setup() {
  Serial.begin(115200);
  Serial.printf("\n[TEST CAMARA] PSRAM: %s\n", psramFound() ? "si" : "no");
  if (!initCamera()) { Serial.println("Sin camara. Revisá alimentación/cableado."); }
}

void loop() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { Serial.println("Captura FALLO"); delay(1000); return; }
  Serial.printf("Foto OK - %u bytes (%dx%d)\n", (unsigned)fb->len, fb->width, fb->height);
  esp_camera_fb_return(fb);
  delay(3000);
}
