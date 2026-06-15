// ============================================================================
//  TEST 7 - NIVEL DE BATERIA   (corre en: ESP32 DevKit v1)   env: test_battery
//  ----------------------------------------------------------------------------
//  18650 -> divisor 100k/100k -> GPIO35 (ADC1_CH7, input-only).
//  Usamos ADC1 porque ADC2 NO funciona con WiFi activo.
//  Vbat = Vadc * 2 (relación del divisor).
//
//  Esperado: imprime voltaje estimado de la batería y % de carga.
//
//  CALIBRACION: el ADC del ESP32 no es lineal. Medí con un multímetro el Vbat
//  real y ajustá BATT_FULL_MV / BATT_EMPTY_MV (o sumá una tabla de calibración).
// ============================================================================
#include <Arduino.h>
#include "config.h"

// Promedia varias lecturas para estabilizar
static float readBatteryMv() {
  uint32_t acc = 0;
  const int N = 32;
  for (int i = 0; i < N; i++) { acc += analogReadMilliVolts(PIN_BATTERY); delay(2); }
  float vadc = acc / (float)N;                 // mV en el pin
  return vadc * BATT_DIVIDER_RATIO;            // mV de la batería
}

static int batteryPercent(float mv) {
  float pct = (mv - BATT_EMPTY_MV) / (BATT_FULL_MV - BATT_EMPTY_MV) * 100.0f;
  if (pct < 0) pct = 0; if (pct > 100) pct = 100;
  return (int)(pct + 0.5f);
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  Serial.println("\n[TEST BATERIA] Leyendo divisor en GPIO35 (ADC1).");
}

void loop() {
  float mv = readBatteryMv();
  Serial.printf("Vbat ~ %.0f mV   carga ~ %d%%\n", mv, batteryPercent(mv));
  delay(1000);
}
