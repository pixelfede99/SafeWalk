// ============================================================================
//  TEST 2 - BOTON DE EMERGENCIA   (corre en: ESP32 DevKit v1)  env: test_button
//  ----------------------------------------------------------------------------
//  Pulsador en GPIO33 con INPUT_PULLUP: en reposo lee HIGH, presionado lee LOW.
//  Incluye antirrebote (debounce) por software.
//  Esperado: cada vez que apretás, imprime "BOTON presionado" y suena un beep.
// ============================================================================
#include <Arduino.h>
#include "config.h"

static int lastStable = HIGH;
static int lastRead   = HIGH;
static uint32_t lastChange = 0;
const uint16_t DEBOUNCE_MS = 30;

static void beep(uint16_t ms) {
  digitalWrite(PIN_BUZZER, HIGH); delay(ms); digitalWrite(PIN_BUZZER, LOW);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
  Serial.println("\n[TEST BOTON] Apreta el pulsador de emergencia (GPIO33).");
}

void loop() {
  int r = digitalRead(PIN_BUTTON);
  if (r != lastRead) { lastChange = millis(); lastRead = r; }

  if (millis() - lastChange > DEBOUNCE_MS && r != lastStable) {
    lastStable = r;
    if (lastStable == LOW) {            // activo en LOW
      Serial.println(">> BOTON presionado");
      beep(60);
    } else {
      Serial.println("   (soltado)");
    }
  }
}
