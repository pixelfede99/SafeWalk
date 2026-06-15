// ============================================================================
//  FirebaseRest.h
//  Cliente mínimo de Firebase para ESP32 vía REST (sin la librería oficial,
//  que es pesada). Lo usan AMBAS placas.
//
//  Hace:
//   - WiFi connect
//   - Login con email/password (Identity Toolkit) -> idToken (+ refresh)
//   - Firestore: PATCH (set), POST (add), update parcial con updateMask
//   - Storage: subida de bytes en RAM o STREAMING desde un archivo (audio)
//   - Helpers para armar el JSON de Firestore y timestamps ISO-8601 (NTP)
//
//  NOTA DE SEGURIDAD: usamos WiFiClientSecure::setInsecure() (no validamos el
//  certificado del server) para simplificar el capstone. En producción se
//  debería fijar el root CA de Google. Está marcado abajo.
// ============================================================================
#pragma once

#include <Arduino.h>
#include <WiFiClientSecure.h>
#include <Stream.h>

class FirebaseRest {
 public:
  // Conecta al WiFi (bloqueante con timeout). true si conectó.
  bool beginWiFi(const char* ssid, const char* pass, uint32_t timeoutMs = 20000);

  // Sincroniza la hora por NTP (necesaria para timestamps y TLS). Bloqueante.
  bool syncTime(uint32_t timeoutMs = 10000);

  // Login con email/password. Guarda idToken/refreshToken. true si OK.
  bool signIn(const char* email, const char* password);

  // Refresca el idToken si está por vencer. Llamalo antes de cada escritura.
  bool ensureToken();

  // ---- Firestore ----
  // SET completo del documento (crea o reemplaza). fieldsJson = contenido de "fields".
  bool firestoreSet(const String& docPath, const String& fieldsJson);

  // UPDATE parcial: solo toca los campos en updateMask (coma-separados).
  bool firestoreUpdate(const String& docPath, const String& fieldsJson,
                       const String& updateMaskFields);

  // ADD: crea doc con id automático dentro de una colección.
  bool firestoreAdd(const String& collectionPath, const String& fieldsJson);

  // ---- Storage ----
  // Sube bytes ya en memoria (foto). Devuelve la URL pública en outUrl.
  bool storageUploadBytes(const String& objectPath, const char* contentType,
                          const uint8_t* data, size_t len, String& outUrl);

  // Sube STREAMING desde un Stream (archivo de la SD) sin bufferear todo en RAM.
  // 'len' es el tamaño total del archivo (Content-Length).
  bool storageUploadStream(const String& objectPath, const char* contentType,
                          Stream& src, size_t len, String& outUrl);

  // ---- Helpers de formato ----
  static String isoTimestampNow();          // "2026-06-15T14:42:44Z"
  static String fStr(const String& s);      // {"stringValue":"..."}
  static String fDouble(double v);          // {"doubleValue": v}
  static String fInt(long v);               // {"integerValue":"v"}
  static String fBool(bool v);              // {"booleanValue": v}
  static String fTimestamp(const String& iso); // {"timestampValue":"..."}
  static String fGeo(double lat, double lng);  // mapValue {lat,lng}

  const String& idToken() const { return _idToken; }

 private:
  String _idToken;
  String _refreshToken;
  uint32_t _tokenExpiryMs = 0;   // millis() en que vence

  bool httpJson(const char* host, const String& path, const char* method,
               const String& body, String& outResponse, int& outCode,
               bool withAuth);
};
