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

// I2S_NUM_1: el driver de la cámara ya usa I2S0 en el ESP32. Si el audio usa el 0,
// i2s_driver_install falla y deja la cámara rota ("Captura de foto fallo").
#define AUDIO_I2S_PORT   I2S_NUM_1

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
static bool audioI2SBegin(uint32_t sampleRate = AUDIO_SAMPLE_RATE,
                          i2s_channel_fmt_t channel = I2S_CHANNEL_FMT_ONLY_LEFT) {
  i2s_config_t cfg = {};
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
  cfg.sample_rate = sampleRate;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;     // el INMP441 entrega 24/32 bits
  cfg.channel_format = channel;                         // L/R a GND -> canal izquierdo
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

// Pico (en 24 bits, sin continua) de ~0,25 s de audio. Sirve para saber si por
// el canal configurado llega señal.
static int32_t audioProbePeak(uint32_t sampleRate) {
  int32_t buf[256];
  size_t got = 0;
  int32_t mn = INT32_MAX, mx = INT32_MIN;
  uint32_t n = 0, want = sampleRate / 4;
  for (int i = 0; i < 4; i++)   // descartar el arranque del micrófono
    i2s_read(AUDIO_I2S_PORT, buf, sizeof(buf), &got, pdMS_TO_TICKS(100));
  while (n < want) {
    if (i2s_read(AUDIO_I2S_PORT, buf, sizeof(buf), &got, pdMS_TO_TICKS(500)) != ESP_OK || !got)
      return 0;
    for (size_t i = 0; i < got / 4 && n < want; i++, n++) {
      const int32_t v = buf[i] >> 8;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
  }
  return (mx - mn) / 2;
}

// Arranca el I2S en el canal donde de verdad llega el micrófono. Con L/R del
// INMP441 a GND el dato va en el canal izquierdo, pero el driver I2S del ESP32
// (IDF 4.x) en algunas versiones tiene izquierdo/derecho invertidos: sin esto,
// se grabaría el canal vacío y la CAM diría "sin micrófono" con el micrófono bien
// conectado. Prueba 0,25 s con cada uno. Devuelve false si el I2S no arranca.
static bool audioI2SBeginAuto(uint32_t sampleRate) {
  if (!audioI2SBegin(sampleRate, I2S_CHANNEL_FMT_ONLY_LEFT)) return false;
  if (audioProbePeak(sampleRate) >= 64) return true;
  audioI2SEnd();
  if (!audioI2SBegin(sampleRate, I2S_CHANNEL_FMT_ONLY_RIGHT)) return false;
  if (audioProbePeak(sampleRate) >= 64) {
    Serial.println("[AUDIO] el micrófono llega por el canal DERECHO (driver con L/R invertidos)");
    return true;
  }
  // Ninguno trae señal: se deja el derecho armado y recordWavToPsram dirá "señal plana".
  return true;
}

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

// ----------------------------------------------------------------------------
//  Grabación a MEMORIA (PSRAM), para el plan gratis de Firebase.
//
//  Sin Storage, el audio viaja como data URL base64 dentro del doc de la
//  alerta (igual que la foto), y el doc tiene un tope de 1 MiB. Por eso:
//    - 8 kHz (calidad de teléfono: alcanza para entender voz) en vez de 16 kHz
//    - pocos segundos (AUDIO_FS_SECONDS)
//  6 s = 96 KB de PCM = ~128 KB en base64. Y no hace falta tarjeta SD.
//
//  Devuelve un buffer en PSRAM con el WAV COMPLETO (cabecera + PCM) y su
//  largo en outLen, o nullptr si falló o si no hay micrófono (señal plana).
//  El que llama tiene que liberarlo con free().
// ----------------------------------------------------------------------------
static void wavHeaderToBuf(uint8_t* h, uint32_t sampleRate, uint32_t dataLen) {
  const uint16_t bits = 16, channels = 1;
  const uint32_t byteRate = sampleRate * channels * bits / 8;
  const uint16_t blockAlign = channels * bits / 8;
  auto w32 = [&](int off, uint32_t v) { memcpy(h + off, &v, 4); };
  auto w16 = [&](int off, uint16_t v) { memcpy(h + off, &v, 2); };
  memcpy(h, "RIFF", 4);      w32(4, 36 + dataLen);
  memcpy(h + 8, "WAVE", 4);
  memcpy(h + 12, "fmt ", 4); w32(16, 16); w16(20, 1); w16(22, channels);
  w32(24, sampleRate);       w32(28, byteRate); w16(32, blockAlign); w16(34, bits);
  memcpy(h + 36, "data", 4); w32(40, dataLen);
}

static uint8_t* recordWavToPsram(uint32_t sampleRate, int seconds, size_t& outLen) {
  outLen = 0;
  const uint32_t samples = sampleRate * (uint32_t)seconds;
  // Se graba en 24 bits (int32) y recién al final se pasa a 16 bits, EN EL MISMO
  // buffer: así la normalización trabaja con toda la resolución del micrófono
  // (la voz a un metro llega muy baja y en 16 bits quedaría en pocos escalones).
  uint8_t* wav = (uint8_t*)ps_malloc(44 + samples * 4);
  if (!wav) { Serial.println("[AUDIO] sin PSRAM para grabar"); return nullptr; }
  int32_t* raw = (int32_t*)(wav + 44);

  // El micrófono arranca con unos ms de basura: los descartamos.
  int32_t i2sBuf[256];
  size_t bytesRead = 0;
  for (int i = 0; i < 4; i++)
    i2s_read(AUDIO_I2S_PORT, i2sBuf, sizeof(i2sBuf), &bytesRead, pdMS_TO_TICKS(100));

  uint32_t n = 0;
  int64_t sum = 0;
  while (n < samples) {
    // Timeout y no portMAX_DELAY: si el I2S se cuelga, mejor una alerta sin
    // audio que una CAM trabada para siempre.
    if (i2s_read(AUDIO_I2S_PORT, i2sBuf, sizeof(i2sBuf), &bytesRead, pdMS_TO_TICKS(500)) != ESP_OK ||
        bytesRead == 0) {
      Serial.println("[AUDIO] el I2S no entrega datos");
      free(wav);
      return nullptr;
    }
    const int got = bytesRead / 4;
    for (int i = 0; i < got && n < samples; i++, n++) {
      // El dato útil del INMP441 está en los 24 bits altos de cada palabra de 32.
      raw[n] = i2sBuf[i] >> 8;
      sum += raw[n];
    }
  }

  // Sacar el offset de continua y buscar el pico.
  const int32_t dc = (int32_t)(sum / (int64_t)samples);
  int32_t peak = 0;
  for (uint32_t i = 0; i < samples; i++) {
    const int32_t v = abs(raw[i] - dc);
    if (v > peak) peak = v;
  }
  if (peak < 64) {
    // Señal plana: no hay micrófono conectado (o está roto). Subir 6 s de
    // silencio solo engordaría el doc de la alerta.
    Serial.println("[AUDIO] señal plana: sin microfono (o mal conectado), no se sube audio");
    free(wav);
    return nullptr;
  }

  // Normalizar: el pico al ~80 % de la escala de 16 bits. Tope de ganancia
  // x64 (36 dB) respecto de tomar los 16 bits altos: más que eso solo sube el
  // ruido de fondo del INMP441.
  const float scale = min(26000.0f / (float)peak, 64.0f / 256.0f);
  int16_t* pcm = (int16_t*)raw;   // en el lugar: el int16 i nunca pisa un int32 sin leer
  for (uint32_t i = 0; i < samples; i++) {
    const int32_t v = (int32_t)((raw[i] - dc) * scale);
    pcm[i] = (int16_t)constrain(v, -32768, 32767);
  }

  wavHeaderToBuf(wav, sampleRate, samples * 2);
  outLen = 44 + samples * 2;
  Serial.printf("[AUDIO] %d s a %lu Hz en PSRAM (%u bytes, ganancia x%.1f)\n",
                seconds, (unsigned long)sampleRate, (unsigned)outLen, scale * 256.0f);
  return wav;
}
