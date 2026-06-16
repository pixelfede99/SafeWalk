// ============================================================================
//  TEST 1 - BUZZER   (corre en: ESP32 DevKit v1)   env: test_buzzer
//  ----------------------------------------------------------------------------
//  Verifica el buzzer activo de 5V manejado por transistor BC547 en GPIO2.
//  El buzzer es ACTIVO: con poner el pin en HIGH ya suena (tono interno).
//  Como va por transistor (GPIO2 -> R1k -> base), HIGH = suena, LOW = calla.
//
//  Hardware: GPIO2 -> R 1k -> base BC547 ; buzzer+ a 5V ; buzzer- al colector ;
//            emisor a GND.
//  Esperado: escuchás 3 beeps cortos, pausa, 1 beep largo, y se repite.
// ============================================================================
#include <Arduino.h>
#include "config.h"

// Suena 'ms' milisegundos
static void beep(uint16_t ms) {
  digitalWrite(PIN_BUZZER, HIGH);
  delay(ms);
  digitalWrite(PIN_BUZZER, LOW);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);   // arranca callado (importante: GPIO2 es strapping)
  Serial.println("\n[TEST BUZZER] GPIO2 via BC547. Deberias escuchar beeps.");
}

void loop() {
  Serial.println("3 beeps cortos...");
  for (int i = 0; i < 3; i++) { beep(80); delay(120); }
  delay(400);
  Serial.println("1 beep largo...");
  beep(600);
  delay(1500);
}
