// ============================================================================
//  audio_record.h  (ESP32-CAM)
//  Graba audio del INMP441 (I2S) directo a un .wav en la MicroSD (SD_MMC 1-bit).
//  NO bufferiza todo en RAM: lee bloques del I2S y los escribe a la SD al vuelo
//  (clave para los ~480KB de 15s sin reventar los ~520KB de RAM del ESP32).
//
//  Formato: PCM 16-bit, mono (canal izquierdo, L/R del INMP441 a GND), 16 kHz.
//  Pines I2S: ver config.h (BCLK=12, WS=4, DATA=13).
//
//  Header-only para compartir entre test_audio_sd y esp32cam_main.
// ============================================================================
#pragma once

#include <Arduino.h>
#include <SD_MMC.h>
#include <driver/i2s.h>
#include "config.h"

#define AUDIO_I2S_PORT   I2S_NUM_0

// Escribe la cabecera WAV (44 bytes). dataLen = bytes de PCM.
static void writeWavHeader(File& f, uint32_t dataLen) {
  uint32_t sampleRate = AUDIO_SAMPLE_RATE;
  uint16_t bits = AUDIO_BITS, channels = 1;
  uint32_t byteRate = sampleRate * channels * bits / 8;
  uint16_t blockAlign = channels * bits / 8;
  uint32_t chunkSize = 36 + dataLen;
  auto w32 = [&](uint32_t v){ f.write((uint8_t*)&v, 4); };
  auto w16 = [&](uint16_t v){ f.write((uint8_t*)&v, 2); };
  f.write((const uint8_t*)"RIFF", 4); w32(chunkSize);
  f.write((const uint8_t*)"WAVE", 4);
  f.write((const uint8_t*)"fmt ", 4); w32(16); w16(1); w16(channels);
  w32(sampleRate); w32(byteRate); w16(blockAlign); w16(bits);
  f.write((const uint8_t*)"data", 4); w32(dataLen);
}

// Inicializa el I2S para el INMP441 (RX, master, mono izquierdo).
static bool audioI2SBegin() {
  i2s_config_t cfg = {};
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
  cfg.sample_rate = AUDIO_SAMPLE_RATE;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;     // el INMP441 entrega 24/32 bits
  cfg.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;       // L/R a GND -> canal izquierdo
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  cfg.dma_buf_count = 6;
  cfg.dma_buf_len = 256;
  cfg.use_apll = false;

  i2s_pin_config_t pins = {};
  pins.bck_io_num = PIN_I2S_BCLK;
  pins.ws_io_num = PIN_I2S_LRCK;
  pins.data_out_num = I2S_PIN_NO_CHANGE;
  pins.data_in_num = PIN_I2S_DATA;

  if (i2s_driver_install(AUDIO_I2S_PORT, &cfg, 0, NULL) != ESP_OK) return false;
  if (i2s_set_pin(AUDIO_I2S_PORT, &pins) != ESP_OK) return false;
  i2s_zero_dma_buffer(AUDIO_I2S_PORT);
  return true;
}

static void audioI2SEnd() { i2s_driver_uninstall(AUDIO_I2S_PORT); }

// Graba 'seconds' a 'path' (ej. "/alert.wav"). Devuelve los bytes de PCM escritos.
// Asume que SD_MMC ya está montado y el I2S ya inicializado.
static uint32_t recordWavToSd(const char* path, int seconds) {
  File f = SD_MMC.open(path, FILE_WRITE);
  if (!f) { Serial.printf("[AUDIO] no pude abrir %s\n", path); return 0; }

  writeWavHeader(f, 0);   // placeholder; lo corregimos al final

  const int N = 256;                  // muestras 32-bit por lectura
  int32_t i2sBuf[N];
  int16_t pcmBuf[N];
  uint32_t pcmBytes = 0;
  uint32_t targetBytes = (uint32_t)AUDIO_SAMPLE_RATE * 2 * seconds;  // 16-bit mono

  while (pcmBytes < targetBytes) {
    size_t bytesRead = 0;
    i2s_read(AUDIO_I2S_PORT, i2sBuf, sizeof(i2sBuf), &bytesRead, portMAX_DELAY);
    int samples = bytesRead / 4;
    for (int i = 0; i < samples; i++) {
      // El dato útil del INMP441 está en los bits altos: tomamos los 16 MSB.
      pcmBuf[i] = (int16_t)(i2sBuf[i] >> 16);
    }
    f.write((uint8_t*)pcmBuf, samples * 2);
    pcmBytes += samples * 2;
  }

  // Reescribimos la cabecera con el tamaño real.
  f.seek(0);
  writeWavHeader(f, pcmBytes);
  f.close();
  Serial.printf("[AUDIO] %s -> %u bytes PCM (%d s)\n", path, pcmBytes, seconds);
  return pcmBytes;
}
