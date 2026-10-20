// ============================================================================
//  SafeWalk - FIRMWARE DEL ESP32-CAM   (ESP32-CAM AI-Thinker)   env: esp32cam
//  ============================================================================
//  Placa dedicada EXCLUSIVAMENTE a cámara + audio.
//
//  Escucha el enlace del DevKit (DevKit GPIO13 -> CAM GPIO3 = U0RXD) y, ante un
//  "ALERT|<alertId>", ejecuta:
//    1) saca una foto (OV2640) y la sube a Storage: alerts/{deviceId}/{alertId}.jpg
//    2) graba 15s de audio (INMP441 -> I2S -> /alert.wav en la MicroSD, 1-bit)
//       y lo sube en STREAMING a Storage: alerts/{deviceId}/{alertId}.wav
//    3) completa photoUrl y audioUrl en el doc alerts/{alertId} (lo creó el DevKit)
//
//  La foto sube desde el frame buffer (PSRAM); el audio sube en streaming desde
//  la SD (NO se bufferiza en RAM). El enlace UART solo trae el alertId (texto).
//
//  >>> Para FLASHEAR esta placa: GPIO0 a GND al bootear y DESCONECTAR el hilo
//      del DevKit que entra a GPIO3 (U0RXD), si no choca con el USB-serial. <<<
//
//  >>> AJUSTAR <<< credenciales en include/secrets.h (WiFi + Firebase).
// ============================================================================
#include <Arduino.h>
#include <SD_MMC.h>
#include "esp_camera.h"
#include "config.h"
#include "camera_pins_aithinker.h"
#include "audio_record.h"
#include "FirebaseRest.h"
#include "mbedtls/base64.h"

// JPEG máximo que mandamos inline (base64 = +33%, y el doc de Firestore tiene 1 MiB)
#define PHOTO_MAX_JPEG_BYTES  (600 * 1024)

FirebaseRest fb;

// ---------------- Cámara ----------------
static bool initCamera() {
  camera_config_t c;
  c.ledc_channel = LEDC_CHANNEL_0; c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0=Y2_GPIO_NUM; c.pin_d1=Y3_GPIO_NUM; c.pin_d2=Y4_GPIO_NUM; c.pin_d3=Y5_GPIO_NUM;
  c.pin_d4=Y6_GPIO_NUM; c.pin_d5=Y7_GPIO_NUM; c.pin_d6=Y8_GPIO_NUM; c.pin_d7=Y9_GPIO_NUM;
  c.pin_xclk=XCLK_GPIO_NUM; c.pin_pclk=PCLK_GPIO_NUM; c.pin_vsync=VSYNC_GPIO_NUM;
  c.pin_href=HREF_GPIO_NUM; c.pin_sccb_sda=SIOD_GPIO_NUM; c.pin_sccb_scl=SIOC_GPIO_NUM;
  c.pin_pwdn=PWDN_GPIO_NUM; c.pin_reset=RESET_GPIO_NUM;
  c.xclk_freq_hz=20000000; c.pixel_format=PIXFORMAT_JPEG;
  if (psramFound()) {
    c.frame_size=FRAMESIZE_SVGA; c.jpeg_quality=12; c.fb_count=2;
    c.fb_location=CAMERA_FB_IN_PSRAM; c.grab_mode=CAMERA_GRAB_LATEST;
  } else {
    c.frame_size=FRAMESIZE_VGA; c.jpeg_quality=15; c.fb_count=1;
    c.fb_location=CAMERA_FB_IN_DRAM; c.grab_mode=CAMERA_GRAB_WHEN_EMPTY;
  }
  return esp_camera_init(&c) == ESP_OK;
}

// ---------------- Manejo de una alerta ----------------
static void handleAlert(const String& alertId) {
  Serial.printf("\n[CAM] Procesando alerta %s\n", alertId.c_str());
  String photoUrl = "", audioUrl = "";

  // ---- 1) FOTO ----
  // Plan gratis (Spark) de Firebase: sin Storage. La foto va como data URL base64
  // dentro del propio doc de la alerta (photoUrl). La app la muestra igual con <img>.
  // Límite de Firestore: 1 MiB por doc -> descartamos JPEG muy grandes.
  camera_fb_t* fbuf = esp_camera_fb_get();
  if (fbuf) {
    if (fbuf->len <= PHOTO_MAX_JPEG_BYTES) {
      size_t b64Len = 0;
      mbedtls_base64_encode(nullptr, 0, &b64Len, fbuf->buf, fbuf->len);
      unsigned char* b64 = (unsigned char*)ps_malloc(b64Len + 1);
      if (b64 && mbedtls_base64_encode(b64, b64Len + 1, &b64Len, fbuf->buf, fbuf->len) == 0) {
        b64[b64Len] = '\0';
        photoUrl.reserve(b64Len + 32);
        photoUrl = "data:image/jpeg;base64,";
        photoUrl += (const char*)b64;
        Serial.printf("[CAM] Foto lista (%u bytes JPEG, %u base64)\n",
                      (unsigned)fbuf->len, (unsigned)b64Len);
      } else {
        Serial.println("[CAM] Foto: sin memoria para base64");
      }
      free(b64);
    } else {
      Serial.printf("[CAM] Foto muy grande (%u bytes), no entra en Firestore\n", (unsigned)fbuf->len);
    }
    esp_camera_fb_return(fbuf);   // liberar YA el buffer (RAM)
  } else {
    Serial.println("[CAM] Captura de foto fallo");
  }

  // ---- 2) AUDIO ----
  if (audioI2SBegin()) {
    uint32_t pcm = recordWavToSd("/alert.wav", AUDIO_RECORD_SECONDS);
    audioI2SEnd();
    if (pcm > 0) {
      File wav = SD_MMC.open("/alert.wav", FILE_READ);
      if (wav) {
        size_t total = wav.size();
        String objPath = String(ST_ALERT_PREFIX) + alertId + ".wav";
        if (fb.storageUploadStream(objPath, "audio/wav", wav, total, audioUrl))
          Serial.printf("[CAM] Audio subido (%u bytes)\n", (unsigned)total);
        else
          Serial.println("[CAM] Audio: fallo al subir");
        wav.close();
      }
    }
  } else {
    Serial.println("[CAM] I2S fallo");
  }

  // ---- 3) Completar URLs en el doc de alerta (PATCH parcial) ----
  String fields = "\"photoUrl\":" + FirebaseRest::fStr(photoUrl) +
                  ",\"audioUrl\":" + FirebaseRest::fStr(audioUrl);
  bool ok = fb.firestoreUpdate(String(FS_ALERTS_COLL) + "/" + alertId,
                               fields, "photoUrl,audioUrl");
  Serial.printf("[CAM] Alerta %s actualizada (%s)\n", alertId.c_str(), ok ? "OK" : "FALLO");
}

// ============================================================================
void setup() {
  Serial.begin(CAM_LINK_BAUD);   // U0RXD recibe el alertId del DevKit a esta velocidad
  Serial.println("\n=== SafeWalk ESP32-CAM ===");

  // WiFi ANTES que la cámara: el pico de corriente al conectar el WiFi, sumado a
  // la cámara ya capturando, disparaba el brownout y la placa se reiniciaba.
  Serial.print("WiFi... ");  Serial.println(fb.beginWiFi(WIFI_SSID, WIFI_PASSWORD) ? "OK" : "FALLO");

  Serial.printf("Camara... %s\n", initCamera() ? "OK" : "FALLO");
  Serial.printf("SD(1-bit)... %s\n", SD_MMC.begin("/sdcard", true) ? "OK" : "FALLO");

  Serial.print("NTP...  ");  Serial.println(fb.syncTime() ? "OK" : "FALLO");
  Serial.print("Login.. ");  Serial.println(fb.signIn(FB_DEVICE_EMAIL, FB_DEVICE_PASSWORD) ? "OK" : "FALLO");

  Serial.println("[CAM] Listo. Esperando ALERT del DevKit...");
}

void loop() {
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.startsWith("ALERT|")) {
      String alertId = line.substring(6);
      alertId.trim();
      if (alertId.length()) handleAlert(alertId);
    }
  }
  fb.ensureToken();   // mantiene el idToken fresco entre alertas
  delay(10);
}
