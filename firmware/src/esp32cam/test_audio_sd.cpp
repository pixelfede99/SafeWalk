// ============================================================================
//  TEST 11 - AUDIO INMP441 -> MicroSD   (ESP32-CAM AI-Thinker)  env: test_audio_sd
//  ----------------------------------------------------------------------------
//  NO se puede simular en Wokwi. Solo hardware real.
//  Monta la MicroSD en modo 1-BIT (libera GPIO4/12/13 para el I2S del micrófono)
//  y graba 5s de audio a /test.wav. Después podés sacar la SD y escuchar el wav.
//
//  Conexión INMP441 (movido a esta placa):
//     SCK -> GPIO12 (BCLK) ,  WS -> GPIO4 (LRCK) ,  SD -> GPIO13 (DATA)
//     VDD -> 3.3V , GND -> GND , L/R -> GND (canal izquierdo)
//
//  IMPORTANTE: SD_MMC.begin("/sdcard", true) -> el 'true' es modo 1-BIT.
//  GPIO4 comparte el flash LED: vas a ver el LED parpadear mientras graba (normal).
// ============================================================================
#include <Arduino.h>
#include <SD_MMC.h>
#include "config.h"
#include "audio_record.h"

void setup() {
  Serial.begin(115200);
  Serial.println("\n[TEST AUDIO+SD]");

  // SD en 1-bit (clave para liberar pines del I2S)
  if (!SD_MMC.begin("/sdcard", true)) {
    Serial.println("SD FALLO. Revisá la tarjeta / formato FAT32.");
    return;
  }
  Serial.println("SD montada (1-bit).");

  if (!audioI2SBegin()) { Serial.println("I2S FALLO."); return; }
  Serial.println("Grabando 5s a /test.wav ...");
  recordWavToSd("/test.wav", 5);
  audioI2SEnd();
  Serial.println("Listo. Sacá la SD y escuchá /test.wav");
}

void loop() { delay(1000); }
