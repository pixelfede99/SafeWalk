// ============================================================================
//  TEST 4 - HC-SR04 (DISTANCIA)   (corre en: ESP32 DevKit v1)   env: test_hcsr04
//  ----------------------------------------------------------------------------
//  TRIG en GPIO26 (salida), ECHO en GPIO25 (entrada, CON divisor de tensión
//  porque el ECHO del HC-SR04 es 5V y el ESP32 es 3.3V).
//
//  Medición: pulso de 10us en TRIG; medimos el ancho del pulso en ECHO con
//  pulseIn(); distancia_cm = duracion_us / 58.
//
//  Esperado: imprime la distancia en cm ~10 veces por segundo.
// ============================================================================
#include <Arduino.h>
#include "config.h"

// Devuelve distancia en cm, o -1 si no hubo eco (timeout / fuera de rango).
static long readDistanceCm() {
  digitalWrite(PIN_HCSR04_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_HCSR04_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_HCSR04_TRIG, LOW);

  // timeout 25ms -> ~4m máx. Evita que el sketch se cuelgue si no hay eco.
  unsigned long us = pulseIn(PIN_HCSR04_ECHO, HIGH, 25000UL);
  if (us == 0) return -1;
  return (long)(us / 58);   // velocidad del sonido ~340 m/s
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_HCSR04_TRIG, OUTPUT);
  pinMode(PIN_HCSR04_ECHO, INPUT);
  digitalWrite(PIN_HCSR04_TRIG, LOW);
  Serial.println("\n[TEST HC-SR04] Medicion de distancia (cm).");
}

void loop() {
  long cm = readDistanceCm();
  if (cm < 0) Serial.println("Sin eco (fuera de rango)");
  else        Serial.printf("Distancia: %ld cm\n", cm);
  delay(ULTRASONIC_INTERVAL_MS);
}
