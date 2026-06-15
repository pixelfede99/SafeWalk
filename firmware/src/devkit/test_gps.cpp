// ============================================================================
//  TEST 6 - GPS NEO-6M   (corre en: ESP32 DevKit v1)   env: test_gps
//  ----------------------------------------------------------------------------
//  UART2: RX2=GPIO16 (<- TX del GPS), TX2=GPIO17 (-> RX del GPS), 9600 baud.
//  Parseo con TinyGPSPlus.
//
//  Esperado:
//   - Al principio "Esperando fix..." (a cielo abierto puede tardar 30s-varios min
//     la primera vez).
//   - Cuando engancha satélites, imprime lat/lng/sats/velocidad.
//
//  TIP: el NEO-6M necesita ver el cielo. Adentro casi nunca consigue fix.
// ============================================================================
#include <Arduino.h>
#include <TinyGPSPlus.h>
#include "config.h"

TinyGPSPlus gps;
HardwareSerial GPSserial(2);   // UART2

void setup() {
  Serial.begin(115200);
  GPSserial.begin(GPS_BAUD, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
  Serial.println("\n[TEST GPS] Leyendo NEO-6M por UART2. Esperando fix...");
}

void loop() {
  while (GPSserial.available()) gps.encode(GPSserial.read());

  static uint32_t last = 0;
  if (millis() - last > 2000) {
    last = millis();
    if (gps.location.isValid()) {
      Serial.printf("FIX  lat=%.6f  lng=%.6f  sats=%lu  vel=%.1f km/h\n",
                    gps.location.lat(), gps.location.lng(),
                    gps.satellites.value(), gps.speed.kmph());
    } else {
      Serial.printf("Esperando fix...  (chars recibidos: %lu, sats: %lu)\n",
                    (unsigned long)gps.charsProcessed(), gps.satellites.value());
    }
  }
}
