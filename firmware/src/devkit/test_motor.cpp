// ============================================================================
//  TEST 3 - MOTOR DE VIBRACION   (corre en: ESP32 DevKit v1)   env: test_motor
//  ----------------------------------------------------------------------------
//  Motor ERM en GPIO27 vía transistor BC547 (+ diodo flyback 1N4007).
//  Usamos PWM (LEDC) para graduar la intensidad de la vibración: así después,
//  en la integración, vibra MAS fuerte cuanto MAS cerca está el obstáculo.
//
//  Esperado: el motor hace una "rampa" de intensidad 0 -> max -> 0, repetida.
// ============================================================================
#include <Arduino.h>
#include "config.h"

void setup() {
  Serial.begin(115200);
  // LEDC: canal, frecuencia, resolución -> luego attach al pin
  ledcSetup(MOTOR_PWM_CHANNEL, MOTOR_PWM_FREQ, MOTOR_PWM_RES);
  ledcAttachPin(PIN_MOTOR, MOTOR_PWM_CHANNEL);
  ledcWrite(MOTOR_PWM_CHANNEL, 0);
  Serial.println("\n[TEST MOTOR] Rampa de vibracion en GPIO27 (PWM).");
}

void loop() {
  Serial.println("Subiendo intensidad...");
  for (int d = 0; d <= 255; d += 5) { ledcWrite(MOTOR_PWM_CHANNEL, d); delay(40); }
  Serial.println("Bajando intensidad...");
  for (int d = 255; d >= 0; d -= 5) { ledcWrite(MOTOR_PWM_CHANNEL, d); delay(40); }
  ledcWrite(MOTOR_PWM_CHANNEL, 0);
  delay(800);
}
