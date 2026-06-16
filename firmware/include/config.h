// ============================================================================
//  SafeWalk - config.h
//  Configuración GLOBAL del firmware (ambas placas).
//
//  Acá viven: el deviceId, los pines, los intervalos y los paths de Firestore.
//  Las CREDENCIALES (WiFi / Firebase) NO van acá: van en secrets.h
//  (que está en .gitignore). Copiá secrets.h.example -> secrets.h y completalo.
//
//  Este archivo se incluye tanto desde el DevKit como desde el ESP32-CAM.
//  Se usa la macro BOARD_DEVKIT / BOARD_ESP32CAM (definida por platformio.ini)
//  para exponer solo los pines de cada placa.
// ============================================================================
#pragma once

#include "secrets.h"   // <-- WiFi + Firebase. Si no compila, falta crear secrets.h

// ----------------------------------------------------------------------------
//  IDENTIDAD DEL DISPOSITIVO
//  >>> AJUSTAR <<< Tiene que coincidir con el deviceId que cargás en el dashboard
//  (documento devices/{deviceId} en Firestore).
// ----------------------------------------------------------------------------
#define SAFEWALK_DEVICE_ID   "SAFEWALK-DEVICE-001"   // <-- placeholder, cambialo

// ----------------------------------------------------------------------------
//  INTERVALOS (milisegundos) - todos ajustables
// ----------------------------------------------------------------------------
#define HEARTBEAT_INTERVAL_MS   10000UL   // refresca devices/{id}: batería, online, ubicación
#define HISTORY_INTERVAL_MS     30000UL   // agrega punto a locations/{id}/history
#define ULTRASONIC_INTERVAL_MS    100UL   // cada cuánto medimos distancia (10 Hz)
#define AUDIO_RECORD_SECONDS       15     // duración de la grabación de la alerta

// ----------------------------------------------------------------------------
//  PARÁMETROS DE FUNCIONAMIENTO (ajustables)
// ----------------------------------------------------------------------------
// Detección de obstáculos: rango en cm donde el motor empieza a vibrar.
#define OBSTACLE_MAX_CM            150     // a más de esto, el motor no vibra
#define OBSTACLE_MIN_CM             20     // a menos de esto, vibración máxima/continua

// Audio (INMP441 en el ESP32-CAM)
#define AUDIO_SAMPLE_RATE        16000     // 16 kHz
#define AUDIO_BITS                  16     // 16-bit
// (mono, canal izquierdo: L/R del INMP441 a GND)

// Batería 18650 (divisor 100k/100k => Vadc = Vbat/2). Ajustá tras calibrar.
#define BATT_FULL_MV             4200.0f   // 18650 cargada
#define BATT_EMPTY_MV            3300.0f   // consideramos "vacía" (corte seguro)
#define BATT_DIVIDER_RATIO          2.0f   // 100k/100k -> Vbat = Vadc * 2

// ----------------------------------------------------------------------------
//  PINES — ESP32 DevKit v1 (cerebro principal)
// ----------------------------------------------------------------------------
#ifdef BOARD_DEVKIT
  // HC-SR04 (obstáculos)
  #define PIN_HCSR04_TRIG     26
  #define PIN_HCSR04_ECHO     25     // OJO: con divisor de tensión (ECHO 5V -> 3.3V)

  // GPS NEO-6M (UART2)
  #define PIN_GPS_RX          16     // RX2 del ESP32  <- TX del GPS
  #define PIN_GPS_TX          17     // TX2 del ESP32  -> RX del GPS
  #define GPS_BAUD            9600

  // MPU-6050 (I2C) + INT de caída libre
  #define PIN_I2C_SDA         21
  #define PIN_I2C_SCL         22
  #define PIN_MPU_INT         34     // input-only, sin pull interno (lo provee el MPU)
  #define MPU_I2C_ADDR        0x68   // AD0 a GND

  // Actuadores
  #define PIN_MOTOR           27     // motor ERM vía transistor BC547 (SOLO obstáculos)
  #define PIN_BUZZER           2     // buzzer activo 5V vía transistor BC547 (feedback)

  // Entradas
  #define PIN_BUTTON          33     // pulsador emergencia, INPUT_PULLUP (activo en LOW)
  #define PIN_BATTERY         35     // ADC1_CH7 (input-only) + divisor 100k/100k

  // Enlace al ESP32-CAM (UART de 1 hilo). GPIO13 reemplaza al GPIO12 original
  // (GPIO12 es strapping y puede impedir el boot si queda en HIGH).
  #define PIN_CAM_TRIGGER     13     // UART1 TX  -> ESP32-CAM GPIO3 (U0RXD)
  #define CAM_LINK_BAUD       9600

  // PWM del motor (LEDC)
  #define MOTOR_PWM_CHANNEL    0
  #define MOTOR_PWM_FREQ     200      // Hz (vibración perceptible)
  #define MOTOR_PWM_RES        8      // bits (0..255)
#endif

// ----------------------------------------------------------------------------
//  PINES — ESP32-CAM AI-Thinker (cámara + audio)
//  Pines MUY justos: cámara + PSRAM + SD(1-bit) ocupan casi todo.
//  En SD_MMC 1-bit se liberan GPIO4, GPIO12 y GPIO13 -> los usamos para el I2S.
// ----------------------------------------------------------------------------
#ifdef BOARD_ESP32CAM
  // I2S micrófono INMP441 (movido desde el DevKit a esta placa)
  #define PIN_I2S_BCLK        12     // SCK del INMP441
  #define PIN_I2S_LRCK         4     // WS  del INMP441  (comparte el flash LED: parpadea al grabar)
  #define PIN_I2S_DATA        13     // SD  del INMP441  (entrada al ESP32)

  // Línea de disparo desde el DevKit (UART). Llega al U0RXD.
  // >>> Desconectá este hilo para flashear el CAM por USB <<<
  #define PIN_TRIGGER_RX       3     // U0RXD <- DevKit GPIO13
  #define CAM_LINK_BAUD     9600

  // Flash LED on-board (lo "sacrificamos": GPIO4 ahora es I2S WS)
  // #define PIN_FLASH_LED      4
#endif

// ----------------------------------------------------------------------------
//  FIRESTORE — paths (coinciden con el schema del dashboard, ver README raíz)
// ----------------------------------------------------------------------------
#define FS_DEVICE_DOC      "devices/" SAFEWALK_DEVICE_ID
#define FS_HISTORY_COLL    "locations/" SAFEWALK_DEVICE_ID "/history"
#define FS_ALERTS_COLL     "alerts"
// Path de los archivos en Storage: alerts/{deviceId}/{alertId}.jpg | .wav
#define ST_ALERT_PREFIX    "alerts/" SAFEWALK_DEVICE_ID "/"
