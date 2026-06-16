// ============================================================================
//  TEST 12 - ENLACE DESDE EL DevKit (RECEPTOR)  (ESP32-CAM)  env: test_trigger_rx
//  ----------------------------------------------------------------------------
//  Contraparte de test_trigger_tx. Recibe por el U0RXD (GPIO3) las líneas que
//  manda el DevKit (DevKit GPIO13 -> CAM GPIO3) y parsea "ALERT|<alertId>".
//
//  Como el U0RXD es el mismo del USB-serial, este test imprime por el MISMO
//  puerto. Para verlo limpio: conectá el hilo del DevKit y abrí el monitor.
//  >>> Para FLASHEAR el CAM, desconectá ese hilo (si no, choca con el USB). <<<
//
//  Esperado: por cada ALERT recibido, parpadea el flash LED (GPIO4) e imprime
//  el alertId. (En la integración real, GPIO4 es I2S WS; acá lo usamos solo
//  como prueba visual rápida.)
// ============================================================================
#include <Arduino.h>
#include "config.h"

#define LED_PIN 4

void setup() {
  Serial.begin(CAM_LINK_BAUD);   // U0RXD recibe del DevKit a esta velocidad
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  Serial.println("\n[TEST TRIGGER RX] Esperando ALERT del DevKit...");
}

void loop() {
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.startsWith("ALERT|")) {
      String alertId = line.substring(6);
      Serial.printf(">> ALERT recibido: %s\n", alertId.c_str());
      for (int i = 0; i < 3; i++) {       // parpadeo de confirmación
        digitalWrite(LED_PIN, HIGH); delay(80);
        digitalWrite(LED_PIN, LOW);  delay(80);
      }
    }
  }
}
