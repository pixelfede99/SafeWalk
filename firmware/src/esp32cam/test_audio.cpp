// ============================================================================
//  TEST - MICRÓFONO INMP441 -> PSRAM   (ESP32-CAM AI-Thinker)   env: test_audio
//  ----------------------------------------------------------------------------
//  NO se puede simular en Wokwi. Solo hardware real. No necesita tarjeta SD.
//  Graba 3 s igual que la alerta (PSRAM, 8 kHz) y muestra:
//    - por qué canal llega el micrófono y con qué nivel
//    - el audio como data URL: copiá esa línea ENTERA, pegala en la barra de
//      direcciones del navegador y se escucha.
//  Para grabar de nuevo: mandá cualquier tecla + Enter por el monitor serie.
//
//  Conexión INMP441:
//     SCK -> GPIO12 (BCLK) ,  WS -> GPIO14 (LRCK) ,  SD -> GPIO13 (DATA)
//     VDD -> 3.3V , GND -> GND , L/R -> GND
// ============================================================================
#include <Arduino.h>
#include "config.h"
#include "audio_record.h"
#include "mbedtls/base64.h"

static void recordOnce() {
  Serial.println("\nGrabando 3 s... (habla cerca del microfono)");
  if (!audioI2SBeginAuto(AUDIO_FS_SAMPLE_RATE)) {
    Serial.println("I2S FALLO: no arranco el driver.");
    return;
  }
  size_t len = 0;
  uint8_t* wav = recordWavToPsram(AUDIO_FS_SAMPLE_RATE, 3, len);
  audioI2SEnd();
  if (!wav) {
    Serial.println("Sin audio. Revisa: VDD 3.3V, GND, L/R a GND, SCK->12, WS->14, SD->13.");
    return;
  }

  size_t b64Len = 0;
  mbedtls_base64_encode(nullptr, 0, &b64Len, wav, len);
  unsigned char* b64 = (unsigned char*)ps_malloc(b64Len + 1);
  if (b64 && mbedtls_base64_encode(b64, b64Len + 1, &b64Len, wav, len) == 0) {
    b64[b64Len] = '\0';
    Serial.println("\nCopia la linea de abajo ENTERA y pegala en la barra del navegador:\n");
    Serial.print("data:audio/wav;base64,");
    // De a pedazos: Serial.print de 64 KB de una vez puede cortarse.
    for (size_t i = 0; i < b64Len; i += 1024) {
      Serial.write(b64 + i, min((size_t)1024, b64Len - i));
      delay(5);
    }
    Serial.println("\n");
  } else {
    Serial.println("Sin memoria para el base64.");
  }
  free(b64);
  free(wav);
  Serial.println("Listo. Mandá cualquier tecla + Enter para grabar de nuevo.");
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_FLASH_LED, OUTPUT);
  digitalWrite(PIN_FLASH_LED, LOW);
  delay(500);
  Serial.println("\n[TEST AUDIO -> PSRAM]");
  if (!psramFound()) {
    Serial.println("No hay PSRAM: esta placa no es una AI-Thinker con PSRAM?");
    return;
  }
  recordOnce();
}

void loop() {
  if (Serial.available()) {
    while (Serial.available()) Serial.read();
    recordOnce();
  }
  delay(20);
}
