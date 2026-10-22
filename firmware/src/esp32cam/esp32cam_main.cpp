// ============================================================================
//  SafeWalk - FIRMWARE DEL ESP32-CAM   (ESP32-CAM AI-Thinker)   env: esp32cam
//  ============================================================================
//  Placa dedicada EXCLUSIVAMENTE a cámara + audio.
//
//  Escucha el enlace del DevKit (DevKit GPIO13 -> CAM GPIO3 = U0RXD) y, ante un
//  "ALERT|<alertId>", ejecuta:
//    1) saca una foto (OV2640) y la sube YA como data URL base64 a photoUrl del
//       doc alerts/{alertId} (lo creó el DevKit)
//    2) graba AUDIO_FS_SECONDS de audio (INMP441 -> I2S -> PSRAM, sin SD) y lo
//       sube igual a audioUrl. Sin micrófono (señal plana) no sube nada.
//
//  Todo va dentro del doc de Firestore porque el plan gratis de Firebase no
//  tiene Storage. El enlace UART solo trae el alertId (texto).
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
#ifdef CAM_DISABLE_BROWNOUT
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#endif

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

// ---------------- Data URL ----------------
// Plan gratis (Spark) de Firebase: sin Storage. La foto y el audio van como data
// URL base64 dentro del propio doc de la alerta; la app los muestra igual con
// <img> y <audio>. Devuelve "" si no hay memoria.
static String toDataUrl(const char* mime, const uint8_t* data, size_t len) {
  size_t b64Len = 0;
  mbedtls_base64_encode(nullptr, 0, &b64Len, data, len);
  unsigned char* b64 = (unsigned char*)ps_malloc(b64Len + 1);
  if (!b64 || mbedtls_base64_encode(b64, b64Len + 1, &b64Len, data, len) != 0) {
    free(b64);
    return "";
  }
  b64[b64Len] = '\0';
  String url;
  url.reserve(b64Len + 40);
  url = String("data:") + mime + ";base64,";
  url += (const char*)b64;
  free(b64);
  return url;
}

// El alertId llega por un cable UART y va directo a la URL de Firestore: si entra
// ruido en la línea, mejor descartarlo que mandar una request rota.
static bool validAlertId(const String& id) {
  if (id.length() < 8 || id.length() > 80) return false;
  for (size_t i = 0; i < id.length(); i++) {
    const char c = id[i];
    if (!isalnum(c) && c != '-' && c != '_') return false;
  }
  return true;
}

// Sube un campo (photoUrl / audioUrl) con hasta 3 intentos: la foto del momento
// de la emergencia no se puede volver a sacar, así que un corte de red de un
// segundo no puede hacer que se pierda.
static bool uploadField(const String& docPath, const char* field, const String& value) {
  for (int attempt = 1; attempt <= 3; attempt++) {
    if (fb.firestoreUpdate(docPath, String("\"") + field + "\":" + FirebaseRest::fStr(value), field))
      return true;
    Serial.printf("[CAM] %s: fallo el intento %d\n", field, attempt);
    if (attempt < 3) delay(3000);
  }
  return false;
}

// ---------------- Manejo de una alerta ----------------
//  Foto primero y subida EN EL ACTO: es lo que la familia necesita ver. El audio
//  se graba después y llega en un segundo PATCH. Antes la foto esperaba los 15 s
//  de grabación para salir junto con el audio.
static void handleAlert(const String& alertId) {
  Serial.printf("\n[CAM] Procesando alerta %s\n", alertId.c_str());
  const String docPath = String(FS_ALERTS_COLL) + "/" + alertId;

  // ---- 1) FOTO ----
  // Límite de Firestore: 1 MiB por doc -> descartamos JPEG muy grandes.
  String photoUrl;
  camera_fb_t* fbuf = esp_camera_fb_get();
  if (fbuf) {
    if (fbuf->len <= PHOTO_MAX_JPEG_BYTES) {
      photoUrl = toDataUrl("image/jpeg", fbuf->buf, fbuf->len);
      if (photoUrl.length())
        Serial.printf("[CAM] Foto lista (%u bytes JPEG)\n", (unsigned)fbuf->len);
      else
        Serial.println("[CAM] Foto: sin memoria para base64");
    } else {
      Serial.printf("[CAM] Foto muy grande (%u bytes), no entra en Firestore\n", (unsigned)fbuf->len);
    }
    esp_camera_fb_return(fbuf);   // liberar YA el buffer (RAM)
  } else {
    Serial.println("[CAM] Captura de foto fallo");
  }
  if (photoUrl.length()) {
    bool ok = uploadField(docPath, "photoUrl", photoUrl);
    Serial.printf("[CAM] Foto subida (%s)\n", ok ? "OK" : "FALLO");
  }
  photoUrl = String();   // liberar antes de grabar

  // ---- 2) AUDIO (a PSRAM, sin SD) ----
  if (audioI2SBeginAuto(AUDIO_FS_SAMPLE_RATE)) {
    size_t wavLen = 0;
    uint8_t* wav = recordWavToPsram(AUDIO_FS_SAMPLE_RATE, AUDIO_FS_SECONDS, wavLen);
    audioI2SEnd();
    if (wav) {
      String audioUrl = toDataUrl("audio/wav", wav, wavLen);
      free(wav);
      if (audioUrl.length()) {
        bool ok = uploadField(docPath, "audioUrl", audioUrl);
        Serial.printf("[CAM] Audio subido (%s)\n", ok ? "OK" : "FALLO");
      } else {
        Serial.println("[CAM] Audio: sin memoria para base64");
      }
    }
  } else {
    Serial.println("[CAM] I2S fallo");
  }
  Serial.printf("[CAM] Alerta %s terminada\n", alertId.c_str());
}

// ============================================================================
void setup() {
#ifdef CAM_DISABLE_BROWNOUT
  // Solo en el env esp32cam_nobod (diagnóstico, ver platformio.ini).
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
#endif
  Serial.begin(CAM_LINK_BAUD);   // U0RXD recibe el alertId del DevKit a esta velocidad
  Serial.println("\n=== SafeWalk ESP32-CAM ===");
#ifdef CAM_DISABLE_BROWNOUT
  Serial.println("!!! DIAGNOSTICO: detector de brownout APAGADO (no usar en el baston) !!!");
#endif

  // WiFi ANTES que la cámara: el pico de corriente al conectar el WiFi, sumado a
  // la cámara ya capturando, disparaba el brownout y la placa se reiniciaba.
  Serial.print("WiFi... ");  Serial.println(fb.beginWiFi(WIFI_SSID, WIFI_PASSWORD) ? "OK" : "FALLO");

  Serial.printf("Camara... %s\n", initCamera() ? "OK" : "FALLO");
  // Sin SD: el audio se graba en PSRAM (ver audio_record.h). La SD solo la usa
  // el test test_audio_sd.

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
      if (validAlertId(alertId)) handleAlert(alertId);
      else Serial.printf("[CAM] alertId invalido, ignorado: %s\n", alertId.c_str());
    }
  }
  // El ESP32 se reconecta solo en la mayoría de los cortes, pero no en todos:
  // si pasan 30 s sin WiFi, forzamos la reconexión.
  static uint32_t wifiLostAt = 0;
  if (WiFi.isConnected()) {
    wifiLostAt = 0;
    fb.ensureToken();   // mantiene el idToken fresco entre alertas
  } else if (!wifiLostAt) {
    wifiLostAt = millis();
    Serial.println("[CAM] WiFi desconectado");
  } else if (millis() - wifiLostAt > 30000UL) {
    Serial.println("[CAM] 30 s sin WiFi: reintentando");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    wifiLostAt = millis();
  }
  delay(10);
}
