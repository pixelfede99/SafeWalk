// ============================================================================
//  TEST 9 - ENLACE AL ESP32-CAM (EMISOR)   (ESP32 DevKit v1)  env: test_trigger_tx
//  ----------------------------------------------------------------------------
//  Prueba el enlace UART de 1 hilo hacia el ESP32-CAM.
//  DevKit GPIO13 (UART1 TX) -> ESP32-CAM GPIO3 (U0RXD).
//
//  Protocolo (texto, por línea):
//     "ALERT|<alertId>\n"   -> pedile al CAM que saque foto + grabe audio.
//
//  Para probar de a dos placas, flasheá test_trigger_rx en el ESP32-CAM.
//  Esperado: cada 5s manda un ALERT con un id incremental; el CAM lo recibe.
// ============================================================================
#include <Arduino.h>
#include "config.h"

HardwareSerial CamLink(1);   // UART1

void setup() {
  Serial.begin(115200);
  // TX en PIN_CAM_TRIGGER (13). El RX (-1) no lo usamos: enlace de 1 hilo.
  CamLink.begin(CAM_LINK_BAUD, SERIAL_8N1, /*rx=*/-1, /*tx=*/PIN_CAM_TRIGGER);
  Serial.println("\n[TEST TRIGGER TX] Enviando ALERT al ESP32-CAM por GPIO13.");
}

void loop() {
  static uint32_t n = 0;
  String alertId = String(SAFEWALK_DEVICE_ID) + "_" + String(millis());
  CamLink.printf("ALERT|%s\n", alertId.c_str());
  Serial.printf("-> enviado ALERT|%s\n", alertId.c_str());
  n++;
  delay(5000);
}
