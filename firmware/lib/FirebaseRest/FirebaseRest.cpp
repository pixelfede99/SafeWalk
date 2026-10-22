// ============================================================================
//  FirebaseRest.cpp  -  ver FirebaseRest.h
// ============================================================================
#include "FirebaseRest.h"
#include <WiFi.h>
#include <ArduinoJson.h>
#include <time.h>
#include <sys/time.h>   // settimeofday (hora del header Date)

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
//  Hora de respaldo: el header "Date" de las respuestas de Google.
//
//  Sin hora válida (NTP no respondió: arranque sin WiFi, o redes que bloquean
//  NTP, como muchas de colegios), el reloj queda en 1970: el heartbeat manda un
//  lastSeen de 1970 (la app ve el bastón "Offline" para siempre) y las alertas
//  quedan fechadas en 1970 (no aparecen como la última). Toda respuesta HTTPS de
//  Google trae "Date: Thu, 22 Oct 2026 11:09:31 GMT", así que la usamos para
//  poner el reloj cuando NTP no lo hizo. Precisión de 1 s: alcanza y sobra.
// ----------------------------------------------------------------------------
bool FirebaseRest::clockValid() { return time(nullptr) >= 1700000000; }

static void clockFromDateHeader(const String& line) {
  if (FirebaseRest::clockValid()) return;          // NTP ya la puso: no tocamos
  int d, y, H, M, S;
  char mon[4] = {0};
  // line = "Date: Thu, 22 Oct 2026 11:09:31 GMT\r"
  if (sscanf(line.c_str() + 5, " %*3s, %d %3s %d %d:%d:%d", &d, mon, &y, &H, &M, &S) != 6) return;
  static const char MONTHS[] = "JanFebMarAprMayJunJulAugSepOctNovDec";
  const char* p = strstr(MONTHS, mon);
  if (!p || (p - MONTHS) % 3) return;
  struct tm t = {};
  t.tm_mday = d; t.tm_mon = (p - MONTHS) / 3; t.tm_year = y - 1900;
  t.tm_hour = H; t.tm_min = M; t.tm_sec = S;
  const time_t epoch = mktime(&t);                  // TZ = UTC (configTime(0, 0, ...))
  if (epoch < 1700000000) return;
  timeval tv = { epoch, 0 };
  settimeofday(&tv, nullptr);
  Serial.println("[FB] hora tomada del header Date (NTP no respondio)");
}

// ----------------------------------------------------------------------------
//  Lector de respuesta HTTP (status + headers + body).
//  IMPORTANTE: decodifica "Transfer-Encoding: chunked" (Google lo usa casi
//  siempre). Sin esto, el body llega con los marcadores de tamaño de chunk
//  mezclados (ej. "7f\n{...}\n0\n") y el JSON no se puede parsear -> el login
//  fallaba porque no encontraba el idToken. También respeta Content-Length.
//  Deja en outResponse SOLO el cuerpo limpio. Devuelve true si 2xx.
// ----------------------------------------------------------------------------
static bool readHttpResponse(WiFiClientSecure& client, int& outCode, String& outResponse) {
  // --- esperar el primer byte ---
  // readStringUntil() corta a 1 s sin datos. Si Firestore tardaba más en contestar,
  // la status line llegaba vacía (código 0) y TODA la respuesta cruda (headers,
  // marcadores de chunk) terminaba en el body. Por eso esperamos explícitamente.
  outCode = 0;
  const uint32_t firstByteDeadline = millis() + 10000;
  while (!client.available() && client.connected() &&
         (int32_t)(firstByteDeadline - millis()) > 0) {
    delay(5);
  }
  if (!client.available()) { outResponse = ""; return false; }   // sin respuesta

  // --- status line ---
  String statusLine = client.readStringUntil('\n');
  { int sp = statusLine.indexOf(' ');
    if (sp > 0) outCode = statusLine.substring(sp + 1, sp + 4).toInt(); }

  // --- headers: detectar chunked / content-length ---
  bool chunked = false;
  long contentLength = -1;
  while (client.connected() || client.available()) {
    String line = client.readStringUntil('\n');
    if (line == "\r" || line.length() == 0) break;            // fin de headers
    String low = line; low.toLowerCase();
    if (low.startsWith("transfer-encoding:") && low.indexOf("chunked") >= 0) chunked = true;
    else if (low.startsWith("content-length:")) contentLength = line.substring(15).toInt();
    else if (low.startsWith("date:")) clockFromDateHeader(line);
  }

  // --- body ---
  // De a bloques: antes se agregaba de a UN carácter al String, y con respuestas
  // grandes (Firestore devuelve el documento completo, que en una alerta trae la
  // foto en base64) eran miles de realocaciones y varios segundos perdidos.
  outResponse = "";
  if (contentLength > 0) outResponse.reserve(contentLength);
  const uint32_t deadline = millis() + 15000;   // corte de seguridad
  char buf[512];

  // Lee hasta 'want' bytes (o hasta que se corte), agregándolos a outResponse.
  auto readBytes = [&](long want) {
    long got = 0;
    while ((want < 0 || got < want) && (int32_t)(deadline - millis()) > 0) {
      const int avail = client.available();
      if (avail > 0) {
        long n = min((long)sizeof(buf), (long)avail);
        if (want >= 0) n = min(n, want - got);
        const int r = client.read((uint8_t*)buf, n);
        if (r > 0) { outResponse.concat(buf, r); got += r; }
      } else if (!client.connected()) {
        break;
      } else {
        delay(1);
      }
    }
  };

  if (chunked) {
    while ((int32_t)(deadline - millis()) > 0) {
      String sizeLine = client.readStringUntil('\n');
      sizeLine.trim();
      if (sizeLine.length() == 0) {
        if (!client.connected() && !client.available()) break;
        continue;
      }
      long chunkSize = strtol(sizeLine.c_str(), nullptr, 16);
      if (chunkSize <= 0) break;                               // chunk final "0"
      readBytes(chunkSize);
      client.readStringUntil('\n');                            // consume el CRLF del chunk
    }
  } else {
    readBytes(contentLength);                                  // -1 = hasta que cierre
  }
  return outCode >= 200 && outCode < 300;
}

// ----------------------------------------------------------------------------
//  WiFi / NTP
// ----------------------------------------------------------------------------
bool FirebaseRest::beginWiFi(const char* ssid, const char* pass, uint32_t timeoutMs) {
  WiFi.mode(WIFI_STA);
#ifdef WIFI_TX_POWER
  // Menos potencia de TX = picos de corriente más chicos al conectar. En el
  // ESP32-CAM esos picos disparaban el brownout y la placa se reiniciaba.
  WiFi.setTxPower(WIFI_TX_POWER);
#endif
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

// Si el reloj no tiene hora, hace una request barata (sin auth) solo para leer el
// header Date. Devuelve true si al final hay hora válida.
bool FirebaseRest::ensureClock() {
  if (clockValid()) return true;
  String resp; int code;
  httpJson(HOST_FS, "/", "GET", "", resp, code, false);   // 404 con header Date
  return clockValid();
}

String FirebaseRest::isoTimestampNow() { return isoTimestamp(time(nullptr)); }

String FirebaseRest::isoTimestamp(time_t t) {
  struct tm tmv;
  gmtime_r(&t, &tmv);
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
  if (!client.connect(host, 443)) { outCode = _lastCode = -1; return false; }

  String req = String(method) + " " + path + " HTTP/1.1\r\n";
  req += "Host: " + String(host) + "\r\n";
  req += "Content-Type: application/json\r\n";
  if (withAuth && _idToken.length())
    req += "Authorization: Bearer " + _idToken + "\r\n";
  req += "Content-Length: " + String(body.length()) + "\r\n";
  req += "Connection: close\r\n\r\n";
  req += body;
  // En bloques y verificando lo escrito: sobre TLS un solo print() manda como mucho
  // ~16 KB (un registro TLS) y descarta el resto en silencio. Con la foto en base64
  // el body supera eso y Firestore se quedaba esperando -> timeout (código 0).
  const uint8_t* p = (const uint8_t*)req.c_str();
  size_t len = req.length(), sent = 0;
  while (sent < len) {
    size_t w = client.write(p + sent, min((size_t)1024, len - sent));
    if (w == 0) { outCode = _lastCode = -2; client.stop(); return false; }
    sent += w;
  }

  bool ok = readHttpResponse(client, outCode, outResponse);
  client.stop();
  _lastCode = outCode;
  return ok;
}

// ----------------------------------------------------------------------------
//  Login (Identity Toolkit) y refresh de token
// ----------------------------------------------------------------------------
bool FirebaseRest::signIn(const char* email, const char* password) {
  // Se guardan para poder re-loguear solos si el refresh del token falla.
  _email = email;
  _password = password;
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
  const long left = (long)(_tokenExpiryMs - millis());
  if (_idToken.length() && left > 5L * 60L * 1000L) return true;

  // Como mucho un intento cada 30 s: cada uno abre TLS y, sin red, puede tardar
  // varios segundos. Sin este freno, la CAM (que llama a esto en cada vuelta del
  // loop) se quedaba reintentando sin parar. Mientras tanto, si el token viejo
  // todavía no venció, se sigue usando.
  if (_lastRenewTryMs && millis() - _lastRenewTryMs < 30000UL)
    return _idToken.length() && left > 0;
  _lastRenewTryMs = millis();

  if (refreshIdToken()) {
    Serial.println("[FB] token renovado");
    return true;
  }

  // Plan B: si el refresh falló (corte de WiFi justo en ese momento, refresh token
  // revocado, etc.), volver a loguear con email/password. Sin esto, a la hora el
  // token vencía y el bastón quedaba sin poder escribir hasta que lo reiniciaran.
  if (!_email.length()) return false;
  Serial.println("[FB] refresh del token fallo, re-logueando...");
  return signIn(_email.c_str(), _password.c_str());
}

bool FirebaseRest::refreshIdToken() {
  if (!_refreshToken.length()) return false;

  String path = String("/v1/token?key=") + FB_API_KEY;
  String body = "grant_type=refresh_token&refresh_token=" + _refreshToken;
  // Este endpoint usa form-urlencoded, no JSON, por eso no pasa por httpJson.
  String resp; int code;
  WiFiClientSecure client; client.setInsecure();
  if (!client.connect(HOST_TOKEN, 443)) return false;
  String req = "POST " + path + " HTTP/1.1\r\nHost: " + HOST_TOKEN + "\r\n";
  req += "Content-Type: application/x-www-form-urlencoded\r\n";
  req += "Content-Length: " + String(body.length()) + "\r\nConnection: close\r\n\r\n" + body;
  client.print(req);
  readHttpResponse(client, code, resp);
  client.stop();

  if (code < 200 || code >= 300) {
    Serial.printf("[FB] refresh token fallo (%d)\n", code);
    return false;
  }
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

// "a,b" -> "&<param>=a&<param>=b"
static String fieldPathsQuery(const char* param, const String& csv) {
  String q;
  int start = 0;
  while (start < (int)csv.length()) {
    int comma = csv.indexOf(',', start);
    String f = (comma < 0) ? csv.substring(start) : csv.substring(start, comma);
    f.trim();
    if (f.length()) q += String("&") + param + "=" + f;
    if (comma < 0) break;
    start = comma + 1;
  }
  return q;
}

bool FirebaseRest::firestoreUpdate(const String& docPath, const String& fieldsJson,
                                   const String& updateMaskFields, String* outDocJson,
                                   const String& returnFields) {
  ensureToken();
  // updateMask = qué campos se escriben (el resto del doc queda intacto).
  String query = fieldPathsQuery("updateMask.fieldPaths", updateMaskFields);
  // mask = qué campos devuelve Firestore en la respuesta. Por defecto devuelve el
  // documento ENTERO, y en una alerta eso es la foto y el audio en base64 de
  // vuelta (~250 KB que la CAM bajaba y tiraba). Si no se pide el documento, se
  // pide un campo que no existe y la respuesta queda en unos pocos bytes.
  if (!outDocJson)                query += "&mask.fieldPaths=_nada";
  else if (returnFields.length()) query += fieldPathsQuery("mask.fieldPaths", returnFields);
  String path = fsDocPath(docPath) + "?" + query.substring(1);  // saca el primer '&'
  String body = "{\"fields\":{" + fieldsJson + "}}";
  String resp; int code;
  bool ok = httpJson(HOST_FS, path, "PATCH", body, resp, code, true);
  if (!ok) Serial.printf("[FB] firestoreUpdate (%d): %s\n", code, resp.c_str());
  // Firestore contesta el PATCH con el documento COMPLETO (también los campos que
  // no tocamos): el heartbeat lo usa para leer órdenes de la app sin gastar lecturas.
  if (ok && outDocJson) *outDocJson = resp;
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
//  LECTURA (el bastón escuchando órdenes de la app)
//
//  Hasta ahora el firmware solo ESCRIBÍA a Firestore. Esto agrega el camino de
//  vuelta, que es lo que permite que la app le pida algo al bastón (ej. "sonar
//  para que te encuentre").
//
//  Costo a tener en cuenta: cada llamada abre una conexión TLS nueva (~1 s) y
//  cuenta como una lectura de la cuota diaria de Firestore. El DevKit ya no la
//  usa para las órdenes de la app: le llegan en la respuesta del heartbeat.
// ----------------------------------------------------------------------------
bool FirebaseRest::firestoreGet(const String& docPath, String& outJson) {
  ensureToken();
  int code;
  // GET sin body: httpJson manda Content-Length: 0, que Google acepta.
  bool ok = httpJson(HOST_FS, fsDocPath(docPath), "GET", "", outJson, code, true);
  // El 404 es esperable y NO es un error: significa que la app todavía no
  // escribió ninguna orden para este bastón. Los demás errores se loguean solo
  // cuando cambian: este GET corre cada pocos segundos y un 403 repetido tapaba
  // todo lo demás en el monitor serie.
  if (!ok && code != 404 && code != _lastGetErr)
    Serial.printf("[FB] firestoreGet (%d): %s\n", code, outJson.c_str());
  _lastGetErr = ok ? 0 : code;
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
  int code = 0; String resp;
  readHttpResponse(client, code, resp);
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
  int code = 0; String resp;
  readHttpResponse(client, code, resp);
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
