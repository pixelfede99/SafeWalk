// ============================================================================
//  TEST 8 - WiFi + FIREBASE (FIRESTORE)   (ESP32 DevKit v1)  env: test_wifi_firestore
//  ----------------------------------------------------------------------------
//  Conecta al WiFi, sincroniza hora (NTP), se loguea en Firebase con el usuario
//  del dispositivo y manda un "heartbeat" al documento devices/{deviceId}.
//
//  >>> AJUSTAR <<< credenciales en include/secrets.h (WiFi + Firebase).
//  >>> AJUSTAR <<< el deviceId en config.h, y creá el doc devices/{deviceId}
//      en Firestore (o dejá que este test lo cree con el PATCH).
//
//  Esperado: en el dashboard tenés que ver el bastón "online", con bateria y
//  una ubicación fija de prueba (Obelisco, CABA). Por serial: "Heartbeat OK".
// ============================================================================
#include <Arduino.h>
#include "config.h"
#include "FirebaseRest.h"

FirebaseRest fb;

void setup() {
  Serial.begin(115200);
  Serial.println("\n[TEST WiFi+Firestore]");

  Serial.print("WiFi... ");
  Serial.println(fb.beginWiFi(WIFI_SSID, WIFI_PASSWORD) ? "OK" : "FALLO");
  Serial.print("NTP... ");
  Serial.println(fb.syncTime() ? "OK" : "FALLO");
  Serial.print("Login Firebase... ");
  Serial.println(fb.signIn(FB_DEVICE_EMAIL, FB_DEVICE_PASSWORD) ? "OK" : "FALLO");
}

void loop() {
  // ubicación de prueba: Obelisco
  double lat = -34.6037, lng = -58.3816;
  int battery = 87;

  String fields =
      "\"batteryLevel\":" + FirebaseRest::fInt(battery) +
      ",\"isOnline\":"    + FirebaseRest::fBool(true) +
      ",\"lastSeen\":"    + FirebaseRest::fTimestamp(FirebaseRest::isoTimestampNow()) +
      ",\"location\":"    + FirebaseRest::fGeo(lat, lng) +
      ",\"speed\":"       + FirebaseRest::fDouble(0.0);

  bool ok = fb.firestoreSet(FS_DEVICE_DOC, fields);
  Serial.println(ok ? "Heartbeat OK" : "Heartbeat FALLO");
  delay(HEARTBEAT_INTERVAL_MS);
}
