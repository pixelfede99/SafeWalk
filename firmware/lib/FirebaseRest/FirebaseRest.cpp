// ============================================================================
//  FirebaseRest.cpp  -  ver FirebaseRest.h
// ============================================================================
#include "FirebaseRest.h"
#include <WiFi.h>
#include <ArduinoJson.h>
#include <time.h>

// Hosts de Google
static const char* HOST_IDTK   = "identitytoolkit.googleapis.com";
static const char* HOST_TOKEN  = "securetoken.googleapis.com";
static const char* HOST_FS     = "firestore.googleapis.com";
static const char* HOST_ST     = "firebasestorage.googleapis.com";

// Credenciales (vienen de secrets.h vía config.h, pero acá las tomamos por macro
// para no acoplar la lib al config). Se inyectan desde el .cpp que la usa.
// Ruta relativa explícita: al compilarse como librería (lib/), el include_dir
// del proyecto (include/) no está en el CPPPATH, así que apuntamos directo.
#include "../../include/config.h"   // FB_API_KEY, FB_PROJECT_ID, FB_STORAGE_BUCKET

// ----------------------------------------------------------------------------
//  WiFi / NTP
// ----------------------------------------------------------------------------
bool FirebaseRest::beginWiFi(const char* ssid, const char* pass, uint32_t timeoutMs) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, pass);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < timeoutMs) {
    delay(250);
  }
  return WiFi.status() == WL_CONNECTED;
}

bool FirebaseRest::syncTime(uint32_t timeoutMs) {
  // UTC (sin offset): los timestamps de Firestore van en UTC / Zulu.
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  uint32_t t0 = millis();
  time_t now = 0;
  while ((now = time(nullptr)) < 1700000000 && millis() - t0 < timeoutMs) {
    delay(200);
  }
  return now >= 1700000000;
}

String FirebaseRest::isoTimestampNow() {
  time_t now = time(nullptr);
  struct tm tmv;
  gmtime_r(&now, &tmv);
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmv);
  return String(buf);
}

// ----------------------------------------------------------------------------
//  HTTP helper: una request JSON con WiFiClientSecure (TLS).
// ----------------------------------------------------------------------------
bool FirebaseRest::httpJson(const char* host, const String& path, const char* method,
                            const String& body, String& outResponse, int& outCode,
                            bool withAuth) {
  WiFiClientSecure client;
  client.setInsecure();   // <-- SEGURIDAD: en producción usar setCACert(googleRootCA)
  if (!client.connect(host, 443)) { outCode = -1; return false; }

  String req = String(method) + " " + path + " HTTP/1.1\r\n";
  req += "Host: " + String(host) + "\r\n";
  req += "Content-Type: application/json\r\n";
  if (withAuth && _idToken.length())
    req += "Authorization: Bearer " + _idToken + "\r\n";
  req += "Content-Length: " + String(body.length()) + "\r\n";
  req += "Connection: close\r\n\r\n";
  req += body;
  client.print(req);

  // --- leer status line ---
  String statusLine = client.readStringUntil('\n');
  outCode = 0;
  { int sp = statusLine.indexOf(' ');
    if (sp > 0) outCode = statusLine.substring(sp + 1, sp + 4).toInt(); }

  // --- saltar headers ---
  while (client.connected()) {
    String line = client.readStringUntil('\n');
    if (line == "\r" || line.length() == 0) break;
  }
  // --- body ---
  outResponse = "";
  while (client.available() || client.connected()) {
    while (client.available()) outResponse += (char)client.read();
  }
  client.stop();
  return outCode >= 200 && outCode < 300;
}

// ----------------------------------------------------------------------------
//  Login (Identity Toolkit) y refresh de token
// ----------------------------------------------------------------------------
bool FirebaseRest::signIn(const char* email, const char* password) {
  String path = String("/v1/accounts:signInWithPassword?key=") + FB_API_KEY;
  String body = String("{\"email\":\"") + email + "\",\"password\":\"" + password +
                "\",\"returnSecureToken\":true}";
  String resp; int code;
  if (!httpJson(HOST_IDTK, path, "POST", body, resp, code, false)) {
    Serial.printf("[FB] signIn fallo (%d): %s\n", code, resp.c_str());
    return false;
  }
  JsonDocument doc;
  if (deserializeJson(doc, resp)) return false;
  _idToken      = doc["idToken"].as<String>();
  _refreshToken = doc["refreshToken"].as<String>();
  long expiresIn = String(doc["expiresIn"].as<const char*>()).toInt();  // segundos
  _tokenExpiryMs = millis() + (expiresIn * 1000UL);
  return _idToken.length() > 0;
}

bool FirebaseRest::ensureToken() {
  // Refrescar si faltan menos de 5 min para vencer.
  if (_idToken.length() && (long)(_tokenExpiryMs - millis()) > 5UL * 60UL * 1000UL)
    return true;
  if (!_refreshToken.length()) return false;

  String path = String("/v1/token?key=") + FB_API_KEY;
  String body = "grant_type=refresh_token&refresh_token=" + _refreshToken;
  // Este endpoint usa form-urlencoded, no JSON; reusamos httpJson cambiando el body.
  // (El header Content-Type sigue siendo json pero Google lo acepta igual; si no,
  //  ver nota. Para máxima compatibilidad re-logueamos si falla.)
  String resp; int code;
  WiFiClientSecure client; client.setInsecure();
  if (!client.connect(HOST_TOKEN, 443)) return false;
  String req = "POST " + path + " HTTP/1.1\r\nHost: " + HOST_TOKEN + "\r\n";
  req += "Content-Type: application/x-www-form-urlencoded\r\n";
  req += "Content-Length: " + String(body.length()) + "\r\nConnection: close\r\n\r\n" + body;
  client.print(req);
  String statusLine = client.readStringUntil('\n');
  { int sp = statusLine.indexOf(' '); if (sp > 0) code = statusLine.substring(sp+1, sp+4).toInt(); }
  while (client.connected()) { String l = client.readStringUntil('\n'); if (l == "\r" || l.length()==0) break; }
  resp = ""; while (client.available() || client.connected()) { while (client.available()) resp += (char)client.read(); }
  client.stop();

  if (code < 200 || code >= 300) return false;
  JsonDocument d; if (deserializeJson(d, resp)) return false;
  _idToken      = d["id_token"].as<String>();
  _refreshToken = d["refresh_token"].as<String>();
  long expiresIn = String(d["expires_in"].as<const char*>()).toInt();
  _tokenExpiryMs = millis() + (expiresIn * 1000UL);
  return _idToken.length() > 0;
}

// ----------------------------------------------------------------------------
//  Firestore
// ----------------------------------------------------------------------------
static String fsDocPath(const String& docPath) {
  return String("/v1/projects/") + FB_PROJECT_ID +
         "/databases/(default)/documents/" + docPath;
}

bool FirebaseRest::firestoreSet(const String& docPath, const String& fieldsJson) {
  ensureToken();
  String body = "{\"fields\":{" + fieldsJson + "}}";
  String resp; int code;
  bool ok = httpJson(HOST_FS, fsDocPath(docPath), "PATCH", body, resp, code, true);
  if (!ok) Serial.printf("[FB] firestoreSet (%d): %s\n", code, resp.c_str());
  return ok;
}

bool FirebaseRest::firestoreUpdate(const String& docPath, const String& fieldsJson,
                                   const String& updateMaskFields) {
  ensureToken();
  // updateMask: ?updateMask.fieldPaths=foo&updateMask.fieldPaths=bar
  String mask;
  int start = 0;
  while (start < (int)updateMaskFields.length()) {
    int comma = updateMaskFields.indexOf(',', start);
    String f = (comma < 0) ? updateMaskFields.substring(start)
                           : updateMaskFields.substring(start, comma);
    f.trim();
    if (f.length()) mask += "&updateMask.fieldPaths=" + f;
    if (comma < 0) break;
    start = comma + 1;
  }
  String path = fsDocPath(docPath) + "?" + mask.substring(1);  // saca el primer '&'
  String body = "{\"fields\":{" + fieldsJson + "}}";
  String resp; int code;
  bool ok = httpJson(HOST_FS, path, "PATCH", body, resp, code, true);
  if (!ok) Serial.printf("[FB] firestoreUpdate (%d): %s\n", code, resp.c_str());
  return ok;
}

bool FirebaseRest::firestoreAdd(const String& collectionPath, const String& fieldsJson) {
  ensureToken();
  String body = "{\"fields\":{" + fieldsJson + "}}";
  String resp; int code;
  bool ok = httpJson(HOST_FS, fsDocPath(collectionPath), "POST", body, resp, code, true);
  if (!ok) Serial.printf("[FB] firestoreAdd (%d): %s\n", code, resp.c_str());
  return ok;
}

// ----------------------------------------------------------------------------
//  Storage  (upload vía REST: POST /v0/b/{bucket}/o?name=<urlencoded path>)
//  La respuesta trae downloadTokens; armamos la URL pública con ?alt=media&token=
// ----------------------------------------------------------------------------
static String urlEncode(const String& s) {
  String out; char buf[4];
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (isalnum(c) || c=='-'||c=='_'||c=='.'||c=='~') out += c;
    else { sprintf(buf, "%%%02X", (uint8_t)c); out += buf; }
  }
  return out;
}

static bool parseStorageResponse(const String& resp, const String& objectPath,
                                 String& outUrl) {
  JsonDocument doc;
  if (deserializeJson(doc, resp)) return false;
  String token = doc["downloadTokens"].as<String>();
  if (!token.length()) return false;
  outUrl = "https://" + String(HOST_ST) + "/v0/b/" + FB_STORAGE_BUCKET +
           "/o/" + urlEncode(objectPath) + "?alt=media&token=" + token;
  return true;
}

bool FirebaseRest::storageUploadBytes(const String& objectPath, const char* contentType,
                                      const uint8_t* data, size_t len, String& outUrl) {
  ensureToken();
  WiFiClientSecure client; client.setInsecure();
  if (!client.connect(HOST_ST, 443)) return false;
  String path = "/v0/b/" + String(FB_STORAGE_BUCKET) + "/o?name=" + urlEncode(objectPath);
  String head = "POST " + path + " HTTP/1.1\r\nHost: " + HOST_ST + "\r\n";
  head += "Authorization: Bearer " + _idToken + "\r\n";
  head += "Content-Type: " + String(contentType) + "\r\n";
  head += "Content-Length: " + String(len) + "\r\nConnection: close\r\n\r\n";
  client.print(head);
  // mandamos en bloques para no saturar
  size_t sent = 0;
  while (sent < len) {
    size_t chunk = min((size_t)1024, len - sent);
    client.write(data + sent, chunk);
    sent += chunk;
  }
  // leer respuesta
  int code = 0; String statusLine = client.readStringUntil('\n');
  { int sp = statusLine.indexOf(' '); if (sp>0) code = statusLine.substring(sp+1,sp+4).toInt(); }
  while (client.connected()) { String l = client.readStringUntil('\n'); if (l=="\r"||l.length()==0) break; }
  String resp = ""; while (client.available() || client.connected()) { while (client.available()) resp += (char)client.read(); }
  client.stop();
  if (code < 200 || code >= 300) { Serial.printf("[FB] storageBytes (%d): %s\n", code, resp.c_str()); return false; }
  return parseStorageResponse(resp, objectPath, outUrl);
}

bool FirebaseRest::storageUploadStream(const String& objectPath, const char* contentType,
                                       Stream& src, size_t len, String& outUrl) {
  ensureToken();
  WiFiClientSecure client; client.setInsecure();
  if (!client.connect(HOST_ST, 443)) return false;
  String path = "/v0/b/" + String(FB_STORAGE_BUCKET) + "/o?name=" + urlEncode(objectPath);
  String head = "POST " + path + " HTTP/1.1\r\nHost: " + HOST_ST + "\r\n";
  head += "Authorization: Bearer " + _idToken + "\r\n";
  head += "Content-Type: " + String(contentType) + "\r\n";
  head += "Content-Length: " + String(len) + "\r\nConnection: close\r\n\r\n";
  client.print(head);

  // STREAMING: leemos del archivo y escribimos al socket en bloques de 1KB.
  // No bufferizamos el archivo completo en RAM (clave para los ~480KB de audio).
  uint8_t buf[1024];
  size_t sent = 0;
  while (sent < len) {
    size_t want = min(sizeof(buf), len - sent);
    size_t got = src.readBytes(buf, want);
    if (got == 0) break;
    client.write(buf, got);
    sent += got;
  }
  int code = 0; String statusLine = client.readStringUntil('\n');
  { int sp = statusLine.indexOf(' '); if (sp>0) code = statusLine.substring(sp+1,sp+4).toInt(); }
  while (client.connected()) { String l = client.readStringUntil('\n'); if (l=="\r"||l.length()==0) break; }
  String resp = ""; while (client.available() || client.connected()) { while (client.available()) resp += (char)client.read(); }
  client.stop();
  if (code < 200 || code >= 300) { Serial.printf("[FB] storageStream (%d): %s\n", code, resp.c_str()); return false; }
  return parseStorageResponse(resp, objectPath, outUrl);
}

// ----------------------------------------------------------------------------
//  Helpers de formato de campos Firestore
// ----------------------------------------------------------------------------
String FirebaseRest::fStr(const String& s)    { return "{\"stringValue\":\"" + s + "\"}"; }
String FirebaseRest::fDouble(double v)        { return "{\"doubleValue\":" + String(v, 6) + "}"; }
String FirebaseRest::fInt(long v)             { return "{\"integerValue\":\"" + String(v) + "\"}"; }
String FirebaseRest::fBool(bool v)            { return String("{\"booleanValue\":") + (v?"true":"false") + "}"; }
String FirebaseRest::fTimestamp(const String& iso) { return "{\"timestampValue\":\"" + iso + "\"}"; }
String FirebaseRest::fGeo(double lat, double lng) {
  return "{\"mapValue\":{\"fields\":{\"lat\":" + fDouble(lat) +
         ",\"lng\":" + fDouble(lng) + "}}}";
}
