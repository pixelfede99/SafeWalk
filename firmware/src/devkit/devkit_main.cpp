// ============================================================================
//  SafeWalk - FIRMWARE PRINCIPAL DEL DevKit   (ESP32 DevKit v1)   env: devkit
//  ============================================================================
//  Cerebro del bastón. Integra todos los periféricos del DevKit:
//    - HC-SR04  : mide distancia y maneja el MOTOR de vibración (SOLO obstáculos)
//    - GPS      : posición -> Firestore (heartbeat + historial)
//    - MPU-6050 : detección de CAIDA por INT de hardware -> alerta
//    - Botón    : emergencia -> alerta
//    - Buzzer   : feedback sonoro (acción / emergencia / caída)  [el motor NO]
//    - WiFi/Firebase: heartbeat, historial y creación del doc de alerta
//    - Enlace al ESP32-CAM (UART 1 hilo, GPIO13 -> CAM GPIO3): le pasa el alertId
//
//  DOS NÚCLEOS, A PROPÓSITO:
//    - Núcleo 1 (loop): sensores, motor, buzzer, botón, GPS. NUNCA toca la red.
//    - Núcleo 0 (netTask): todo lo de Firebase / push / poll.
//  Cada request HTTPS bloquea ~1-2 s (handshake TLS). Medido en el bastón real
//  con todo en el loop: trabas de hasta 2,5 s y el 25 % del tiempo bloqueado, o
//  sea hasta 3,5 m caminando SIN detectar obstáculos. Separando la red en otra
//  tarea, el loop sigue midiendo mientras Firebase tarda lo que tarde.
//  Comunicación entre los dos (sin compartir objetos que no son thread-safe):
//    - cola de emergencias          loop -> red
//    - foto del GPS (con mutex)     loop -> red
//    - pedido de "sonar" (atómico)  red  -> loop
//    - resultado de la alerta       red  -> loop (para avisar con el buzzer)
//
//  Flujo de ENCONTRAR EL BASTON (la app le pide al baston que suene):
//    1) la app escribe commands/{deviceId} con un ringToken nuevo + ringSeconds
//    2) el DevKit lee ese doc cada RING_POLL_INTERVAL_MS (unico camino de
//       LECTURA del firmware: todo lo demas es escritura)
//    3) si el token cambio, hace pitar el buzzer en rafagas, sin bloquear el loop
//    4) escribe ackToken de vuelta para que la app pueda decirle al usuario
//       que el baston SI recibio la orden (el usuario ciego no puede mirarlo)
//
//  Flujo de EMERGENCIA (botón o caída):
//    1) buzzer avisa (3 pitidos)
//    2) DevKit crea alerts/{alertId} con ubicación, qué la disparó (trigger) y de
//       dónde salió la ubicación (locationSource). photoUrl/audioUrl vacíos.
//    3) DevKit manda "ALERT|<alertId>" al ESP32-CAM
//    4) DevKit llama a /api/notify (Vercel) -> push a la familia
//    5) buzzer confirma: 1 pitido largo = enviada; 5 cortitos = NO se pudo
//       enviar (el usuario no puede ver una pantalla: tiene que saber si
//       volver a apretar)
//    6) el ESP32-CAM saca la foto y completa photoUrl (data URL base64, sin
//       Storage porque el plan de Firebase es el gratuito).
//
//  Comandos por el monitor serie (115200), para probar sin tocar el hardware:
//    SOS     -> dispara la emergencia igual que el botón
//    STATUS  -> WiFi, Firebase, GPS, batería, memoria, trabas del loop
//    RING    -> hace sonar el patrón de "encontrar el bastón" 5 s
//    AYUDA   -> lista de comandos
//
//  >>> AJUSTAR <<< credenciales en include/secrets.h y deviceId en config.h.
// ============================================================================
#include <Arduino.h>
#include <Wire.h>
#include <TinyGPSPlus.h>
#include <ArduinoJson.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <atomic>
#include "config.h"
#include "FirebaseRest.h"

// ---------------- Objetos globales ----------------
FirebaseRest   fb;             // SOLO lo usa netTask (no es thread-safe)
TinyGPSPlus    gps;            // SOLO lo usa el loop
HardwareSerial GPSserial(2);   // UART2 (GPS)
HardwareSerial CamLink(1);     // UART1 (hacia ESP32-CAM, solo TX en GPIO13)

static uint32_t g_lastUltra = 0;

// ---------------- Emergencias ----------------
enum Reason : uint8_t { REASON_BOTON = 0, REASON_CAIDA = 1, REASON_PRUEBA = 2 };
static const char* const REASON_NAMES[] = { "boton", "caida", "prueba" };

static QueueHandle_t      g_emergencyQ = nullptr;   // loop -> red
static std::atomic<bool>  g_emergencyInFlight{false};
static std::atomic<int>   g_alertResult{0};         // red -> loop: 1 enviada, 2 falló

// ---------------- GPS compartido (loop escribe, red lee) ----------------
// Última ubicación conocida. Arranca en 0,0 = "sin ubicación" (la app lo entiende
// así). Antes arrancaba en el Obelisco, y una alerta sin GPS mostraba ese punto
// como si fuera real: la familia podía salir a buscar al lugar equivocado.
struct GpsSnap {
  double   lat = 0.0, lng = 0.0, speed = 0.0;
  bool     hasFix = false;     // hubo AL MENOS un fix desde que arrancó
  uint32_t fixAtMs = 0;        // millis() del último fix válido
};
static GpsSnap      g_gps;
static portMUX_TYPE g_gpsMux = portMUX_INITIALIZER_UNLOCKED;

static GpsSnap gpsSnapshot() {
  portENTER_CRITICAL(&g_gpsMux);
  GpsSnap s = g_gps;
  portEXIT_CRITICAL(&g_gpsMux);
  return s;
}

// TinyGPS deja isValid() en true para siempre después del primer fix, así que
// para saber si la posición es actual hay que mirar cuánto hace que llegó.
static const uint32_t GPS_FRESH_MS = 15000UL;
static bool gpsFresh(const GpsSnap& s) {
  return s.hasFix && (millis() - s.fixAtMs) < GPS_FRESH_MS;
}
// Lo que se guarda en la alerta para que la app sepa cuánto creerle al mapa:
//   device      -> fix actual del GPS del bastón
//   device_last -> el GPS perdió señal: es la ÚLTIMA posición conocida
//   unknown     -> nunca hubo fix: no hay ubicación (lat/lng = 0,0)
static const char* locationSource(const GpsSnap& s) {
  if (gpsFresh(s)) return "device";
  if (s.hasFix)    return "device_last";
  return "unknown";
}

// ---------------- Estado de la red (para STATUS) ----------------
// Lo escribe netTask, lo lee printStatus(). Son enteros sueltos: una lectura
// "a medias" no rompe nada, a lo sumo muestra un valor de hace un instante.
struct NetStatus {
  volatile int      lastHttp = 0;
  volatile bool     tokenOk = false;
  volatile uint32_t pollEveryMs = RING_POLL_INTERVAL_MS;
  volatile int      batteryPct = 0;
  volatile uint32_t batteryMv = 0;
  volatile uint32_t lastHeartbeatOkMs = 0;
  volatile int      lastNotify = 0;
};
static NetStatus g_net;

// ---------------- MPU-6050 (registros) ----------------
#define REG_PWR_MGMT_1 0x6B
#define REG_ACCEL_CONFIG 0x1C
#define REG_FF_THR 0x1D
#define REG_FF_DUR 0x1E
#define REG_INT_PIN_CFG 0x37
#define REG_INT_ENABLE 0x38
#define REG_INT_STATUS 0x3A
#define REG_WHO_AM_I 0x75

volatile bool g_fallFlag = false;
static bool g_mpuOk = false;   // si el MPU no responde, no hay detección de caída
void IRAM_ATTR onMpuInt() { g_fallFlag = true; }

static void mpuWr(uint8_t r, uint8_t v) {
  Wire.beginTransmission(MPU_I2C_ADDR); Wire.write(r); Wire.write(v); Wire.endTransmission();
}
static uint8_t mpuRd(uint8_t r) {
  Wire.beginTransmission(MPU_I2C_ADDR); Wire.write(r); Wire.endTransmission(false);
  if (Wire.requestFrom((int)MPU_I2C_ADDR, 1) != 1) return 0;   // sin respuesta -> 0, no 0xFF
  return Wire.read();
}
static void mpuInit() {
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  // WHO_AM_I del MPU-6050 = 0x68. Sin sensor, el pin INT queda flotando y dispara
  // "caídas" falsas, así que directamente no se habilita la interrupción.
  uint8_t who = mpuRd(REG_WHO_AM_I);
  g_mpuOk = (who == 0x68);
  Serial.printf("MPU-6050... %s (WHO_AM_I=0x%02X)\n", g_mpuOk ? "OK" : "NO DETECTADO, caidas desactivadas", who);
  if (!g_mpuOk) return;
  mpuWr(REG_PWR_MGMT_1, 0x00); delay(100);
  mpuWr(REG_ACCEL_CONFIG, 0x00);       // ±2g
  mpuWr(REG_FF_THR, 0x20);             // umbral free-fall (AJUSTAR en campo)
  mpuWr(REG_FF_DUR, 0x28);             // duración free-fall (AJUSTAR en campo)
  mpuWr(REG_INT_PIN_CFG, 0x00);
  mpuWr(REG_INT_ENABLE, 0x80);         // FF_EN
  pinMode(PIN_MPU_INT, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_MPU_INT), onMpuInt, RISING);
  mpuRd(REG_INT_STATUS);               // limpia
}

// ---------------- Buzzer (NO bloqueante, solo lo toca el loop) ----------------
// Un único "trabajo" a la vez: una ráfaga de N pitidos (emergencia, confirmación)
// o el patrón de "encontrar el bastón" (grupos de pitidos hasta un tiempo límite).
// Antes los pitidos usaban delay(): cada emergencia trababa el loop ~1 s.
struct BeepJob {
  bool     active = false;
  int      beepsLeft = 0;        // -1 = sin límite de pitidos (corta por tiempo)
  uint32_t untilMs = 0;          // 0 = sin límite de tiempo (corta por cantidad)
  uint16_t onMs = 0, offMs = 0;
  uint8_t  group = 0;            // pitidos por grupo (0 = sin grupos)
  uint16_t groupPauseMs = 0;
  bool     isRing = false;
  // estado
  bool     on = false;
  int      count = 0;
  uint32_t nextToggle = 0;
};
static BeepJob g_beep;

static void buzzerStop() {
  g_beep.active = false;
  g_beep.on = false;
  digitalWrite(PIN_BUZZER, LOW);
}

// Ráfaga de n pitidos. Pisa lo que estuviera sonando (incluido el "encontrar").
static void buzzerPattern(int n, uint16_t onMs, uint16_t offMs) {
  g_beep = BeepJob();
  g_beep.active = true; g_beep.beepsLeft = n; g_beep.onMs = onMs; g_beep.offMs = offMs;
  g_beep.nextToggle = millis();
}

// Patrón de "encontrar el bastón" durante secs segundos.
static void buzzerRing(uint32_t secs) {
  g_beep = BeepJob();
  g_beep.active = true; g_beep.isRing = true; g_beep.beepsLeft = -1;
  g_beep.untilMs = millis() + secs * 1000UL;
  g_beep.onMs = RING_BEEP_ON_MS; g_beep.offMs = RING_BEEP_OFF_MS;
  // Pausa larga cada RING_BEEP_GROUP pitidos: el silencio es justamente lo
  // que deja ubicar de dónde viene el sonido.
  g_beep.group = RING_BEEP_GROUP; g_beep.groupPauseMs = RING_GROUP_PAUSE_MS;
  g_beep.nextToggle = millis();
}

static void updateBuzzer() {
  if (!g_beep.active) return;
  const uint32_t now = millis();
  if (g_beep.untilMs && (int32_t)(now - g_beep.untilMs) >= 0) {
    if (g_beep.isRing) Serial.println("[RING] fin");
    buzzerStop();
    return;
  }
  if ((int32_t)(now - g_beep.nextToggle) < 0) return;

  if (g_beep.on) {
    digitalWrite(PIN_BUZZER, LOW);
    g_beep.on = false;
    g_beep.count++;
    if (g_beep.beepsLeft >= 0 && g_beep.count >= g_beep.beepsLeft) { buzzerStop(); return; }
    const bool endOfGroup = g_beep.group && (g_beep.count % g_beep.group) == 0;
    g_beep.nextToggle = now + (endOfGroup ? g_beep.groupPauseMs : g_beep.offMs);
  } else {
    digitalWrite(PIN_BUZZER, HIGH);
    g_beep.on = true;
    g_beep.nextToggle = now + g_beep.onMs;
  }
}

// ---------------- Motor (SOLO obstáculos) ----------------
// Vibra más fuerte y más seguido cuanto más cerca está el obstáculo.
static uint32_t g_motorNextToggle = 0;
static bool     g_motorOn = false;
static void updateObstacleMotor(long cm) {
  if (cm < 0 || cm > OBSTACLE_MAX_CM) {       // sin obstáculo cercano -> motor off
    if (g_motorOn) { ledcWrite(MOTOR_PWM_CHANNEL, 0); g_motorOn = false; }
    return;
  }
  long c = constrain(cm, (long)OBSTACLE_MIN_CM, (long)OBSTACLE_MAX_CM);
  // intensidad: cerca -> 255, lejos -> ~90
  int duty = map(c, OBSTACLE_MIN_CM, OBSTACLE_MAX_CM, 255, 90);
  // cadencia: cerca -> pulsos rápidos (80ms), lejos -> lentos (600ms)
  int period = map(c, OBSTACLE_MIN_CM, OBSTACLE_MAX_CM, 80, 600);
  uint32_t now = millis();
  if (now >= g_motorNextToggle) {
    g_motorOn = !g_motorOn;
    ledcWrite(MOTOR_PWM_CHANNEL, g_motorOn ? duty : 0);
    g_motorNextToggle = now + period;
  }
}

// ---------------- HC-SR04 ----------------
static long readDistanceCm() {
  digitalWrite(PIN_HCSR04_TRIG, LOW); delayMicroseconds(2);
  digitalWrite(PIN_HCSR04_TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(PIN_HCSR04_TRIG, LOW);
  unsigned long us = pulseIn(PIN_HCSR04_ECHO, HIGH, 25000UL);
  if (us == 0) return -1;
  return (long)(us / 58);
}

// ---------------- Batería ----------------
static uint32_t readBatteryMv() {
  uint32_t acc = 0; const int N = 16;
  for (int i = 0; i < N; i++) acc += analogReadMilliVolts(PIN_BATTERY);
  return (uint32_t)((acc / (float)N) * BATT_DIVIDER_RATIO);
}
static int batteryPercent(uint32_t mv) {
  float pct = (mv - BATT_EMPTY_MV) / (BATT_FULL_MV - BATT_EMPTY_MV) * 100.0f;
  return (int)constrain(pct, 0.0f, 100.0f);
}

// ============================================================================
//  RED (netTask, núcleo 0). Nada de esto se llama desde el loop.
// ============================================================================

// ---------------- "Encontrar el bastón" (pedido de la app) -------------------
//  La app escribe en commands/{deviceId} un `ringToken` y `ringSeconds`.
//
//  El token es un NONCE, no una marca de tiempo: solo miramos si cambió
//  respecto del último que vimos, nunca lo comparamos contra nuestro reloj ni
//  por orden. Gracias a eso la función anda aunque el celular tenga la hora
//  mal, que es un caso bastante común.
//
//  Nota de alcance: esto encuentra el bastón POR EL SONIDO. El GPS no sirve
//  para esto (adentro de una casa no hay fix), así que el buzzer es la función,
//  no un accesorio.
// ----------------------------------------------------------------------------
static long long g_lastRingToken  = 0;
static bool      g_ringTokenKnown = false;
// Pedido de la red al loop: -1 = nada, 0 = parar, >0 = sonar N segundos.
static std::atomic<int32_t> g_ringRequest{-1};

// Firestore serializa los enteros como STRING dentro de integerValue, y un
// Date.now() en milisegundos no entra en 32 bits -> atoll, no toInt().
static long long jsonInt(JsonDocument& doc, const char* field, long long fallback) {
  const char* raw = doc["fields"][field]["integerValue"].as<const char*>();
  return raw ? atoll(raw) : fallback;
}

// Le confirma a la app qué orden ejecutamos. No es un lujo: el usuario ciego no
// puede mirar el bastón para saber si la orden llegó, así que sin este eco la
// pantalla le estaría diciendo "está sonando" sin tener con qué respaldarlo.
static void ringAck(long long token) {
  char buf[24];
  snprintf(buf, sizeof(buf), "%lld", token);
  String fields = String("\"ackToken\":{\"integerValue\":\"") + buf + "\"}";
  fb.firestoreUpdate(FS_COMMANDS_DOC, fields, "ackToken");
}

// Si Firestore dice 403 es porque las reglas publicadas no incluyen commands/.
// Reintentar cada 5 s no lo arregla y gasta red, así que espaciamos a 1 minuto
// hasta que vuelva a andar.
static const uint32_t RING_POLL_BACKOFF_MS = 60000UL;

static void pollRingCommand() {
  String json;
  if (!fb.firestoreGet(FS_COMMANDS_DOC, json)) {      // 404 = todavía no hay órdenes
    if (fb.lastHttpCode() == 403) {
      if (g_net.pollEveryMs != RING_POLL_BACKOFF_MS)
        Serial.println("[RING] Sin permiso para leer commands/ -> falta publicar "
                       "firestore.rules en Firebase. Reintento cada 60 s.");
      g_net.pollEveryMs = RING_POLL_BACKOFF_MS;
    }
    return;
  }
  if (g_net.pollEveryMs != RING_POLL_INTERVAL_MS) Serial.println("[RING] commands/ accesible de nuevo");
  g_net.pollEveryMs = RING_POLL_INTERVAL_MS;

  JsonDocument doc;
  if (deserializeJson(doc, json)) return;

  const long long token = jsonInt(doc, "ringToken", 0);
  if (token == 0) return;

  // Primer poll después de bootear: adoptamos el token que haya SIN actuar.
  // Si no, el bastón se pondría a sonar solo cada vez que se reinicia,
  // repitiendo una orden vieja que ya nadie pidió.
  if (!g_ringTokenKnown) {
    g_lastRingToken  = token;
    g_ringTokenKnown = true;
    return;
  }
  if (token == g_lastRingToken) return;   // nada nuevo
  g_lastRingToken = token;

  long secs = (long)jsonInt(doc, "ringSeconds", 0);
  if (secs <= 0) {                        // 0 = "pará"
    g_ringRequest = 0;
    Serial.println("[RING] parar (pedido de la app)");
    ringAck(token);
    return;
  }
  // Tope propio: no confiamos en el número que mandó la app. Un bug o un reloj
  // raro del lado del celular no puede dejar el buzzer sonando para siempre.
  if (secs > RING_MAX_SECONDS) secs = RING_MAX_SECONDS;

  g_ringRequest = (int32_t)secs;
  Serial.printf("[RING] sonando %ld s\n", secs);
  ringAck(token);
}

// ---------------- Push a la familia (vía la app en Vercel) ----------------
static void notifyFamily(const String& alertId) {
  WiFiClientSecure tls;
  tls.setInsecure();                        // igual que FirebaseRest (sin CA pinning)
  HTTPClient http;
  http.setTimeout(8000);
  if (!http.begin(tls, "https://" NOTIFY_HOST "/api/notify")) {
    Serial.println("Notify: no pude conectar");
    g_net.lastNotify = -1;
    return;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + fb.idToken());
  int code = http.POST("{\"alertId\":\"" + alertId + "\"}");
  Serial.printf("Notify: HTTP %d %s\n", code, code > 0 ? http.getString().c_str() : "");
  g_net.lastNotify = code;
  http.end();
}

// ---------------- EMERGENCIA (lado red) ----------------
static void sendEmergency(uint8_t reason) {
  const GpsSnap g = gpsSnapshot();

  String alertId = String(SAFEWALK_DEVICE_ID) + "_" + FirebaseRest::isoTimestampNow();
  alertId.replace(":", "-");                // ':' no es válido en ids/paths

  // 1) Crear el doc de alerta con la ubicación (la foto la completa el CAM)
  String fields =
      "\"deviceId\":"  + FirebaseRest::fStr(SAFEWALK_DEVICE_ID) +
      ",\"timestamp\":" + FirebaseRest::fTimestamp(FirebaseRest::isoTimestampNow()) +
      ",\"location\":"  + FirebaseRest::fGeo(g.lat, g.lng) +
      ",\"locationSource\":" + FirebaseRest::fStr(locationSource(g)) +
      ",\"source\":"    + FirebaseRest::fStr("device") +
      ",\"trigger\":"   + FirebaseRest::fStr(REASON_NAMES[reason]) +
      ",\"photoUrl\":"  + FirebaseRest::fStr("") +
      ",\"audioUrl\":"  + FirebaseRest::fStr("") +
      ",\"seen\":"      + FirebaseRest::fBool(false);
  bool ok = fb.firestoreSet(String(FS_ALERTS_COLL) + "/" + alertId, fields);
  Serial.printf("Alerta creada: %s (%s)\n", alertId.c_str(), ok ? "OK" : "FALLO");

  // 2) Avisar al ESP32-CAM que capture la foto para este alertId
  CamLink.printf("ALERT|%s\n", alertId.c_str());

  // 3) Push a la familia (llega aunque tengan la app cerrada)
  if (ok) notifyFamily(alertId);

  g_alertResult = ok ? 1 : 2;               // el loop avisa con el buzzer
  g_emergencyInFlight = false;
}

static void sendHeartbeat() {
  const GpsSnap g = gpsSnapshot();
  const bool fresh = gpsFresh(g);
  const uint32_t mv = readBatteryMv();
  g_net.batteryMv = mv;
  g_net.batteryPct = batteryPercent(mv);

  String fields =
      "\"batteryLevel\":" + FirebaseRest::fInt(g_net.batteryPct) +
      ",\"isOnline\":"    + FirebaseRest::fBool(true) +
      ",\"lastSeen\":"    + FirebaseRest::fTimestamp(FirebaseRest::isoTimestampNow()) +
      ",\"location\":"    + FirebaseRest::fGeo(g.lat, g.lng) +
      ",\"gpsFix\":"      + FirebaseRest::fBool(fresh) +
      ",\"speed\":"       + FirebaseRest::fDouble(fresh ? g.speed : 0.0);
  // updateMask, NO firestoreSet: un PATCH sin updateMask reemplaza el
  // documento ENTERO en la REST API de Firestore, o sea que este heartbeat
  // le borraba a devices/{id} los campos que solo escribe la app
  // (ownerUid, caregiverUids, name, inviteCode) cada 10 segundos.
  if (fb.firestoreUpdate(FS_DEVICE_DOC, fields,
                         "batteryLevel,isOnline,lastSeen,location,gpsFix,speed"))
    g_net.lastHeartbeatOkMs = millis();
}

static void sendHistoryPoint(const GpsSnap& g) {
  String fields =
      "\"lat\":"       + FirebaseRest::fDouble(g.lat) +
      ",\"lng\":"      + FirebaseRest::fDouble(g.lng) +
      ",\"timestamp\":" + FirebaseRest::fTimestamp(FirebaseRest::isoTimestampNow());
  fb.firestoreAdd(FS_HISTORY_COLL, fields);
}

static void netTask(void*) {
  uint32_t lastHeartbeat = 0, lastHistory = 0, lastPoll = 0;
  bool first = true;
  for (;;) {
    // Esperar una emergencia hasta 50 ms: así una alerta sale apenas se aprieta
    // el botón (salvo que justo haya una request en curso), y si no hay ninguna
    // esto hace de pausa del ciclo.
    uint8_t reason;
    if (xQueueReceive(g_emergencyQ, &reason, pdMS_TO_TICKS(50)) == pdTRUE) {
      sendEmergency(reason);
      continue;   // si había otra en cola, que salga ya
    }

    const uint32_t now = millis();
    if (first || now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
      lastHeartbeat = now;
      sendHeartbeat();
    }

    // Historial solo con fix ACTUAL: repetir la última posición conocida
    // ensuciaría el recorrido con puntos falsos.
    const GpsSnap g = gpsSnapshot();
    if (gpsFresh(g) && now - lastHistory >= HISTORY_INTERVAL_MS) {
      lastHistory = now;
      sendHistoryPoint(g);
    }

    if (first || now - lastPoll >= g_net.pollEveryMs) {
      lastPoll = now;
      pollRingCommand();
    }

    g_net.lastHttp = fb.lastHttpCode();
    g_net.tokenOk  = fb.idToken().length() > 0;
    first = false;
  }
}

// ============================================================================
//  LOOP (núcleo 1): sensores y feedback. Nada acá puede bloquear.
// ============================================================================

// Dispara una emergencia: suena ya (feedback inmediato) y le pasa el trabajo de
// red a netTask. Mientras una alerta se está mandando, otra presión se ignora
// (en un apuro se aprieta varias veces y no queremos 5 alertas iguales), pero si
// la anterior falló se puede volver a intentar.
static void raiseEmergency(Reason reason) {
  if (g_emergencyInFlight) {
    Serial.println("(emergencia ya en curso, ignorada)");
    return;
  }
  Serial.printf("\n*** EMERGENCIA (%s) ***\n", REASON_NAMES[reason]);
  buzzerPattern(3, 120, 100);               // aviso sonoro (pisa al "encontrar")
  uint8_t r = reason;
  g_emergencyInFlight = true;
  if (xQueueSend(g_emergencyQ, &r, 0) != pdTRUE) {
    g_emergencyInFlight = false;
    Serial.println("Cola de emergencias llena");
  }
}

// ---------------- Métrica: cuánto se traba el loop ----------------
// Mientras el loop está trabado NO se miden obstáculos. Esto mide el peor hueco
// entre dos vueltas y qué porcentaje del tiempo se pasó en huecos de más de
// 150 ms, desde el último STATUS.
static uint32_t g_loopPrev = 0, g_loopMaxGap = 0, g_loopBlockedMs = 0, g_loopWindowStart = 0;
static void loopMetric() {
  const uint32_t now = millis();
  if (g_loopPrev) {
    const uint32_t gap = now - g_loopPrev;
    if (gap > g_loopMaxGap) g_loopMaxGap = gap;
    if (gap > 150) g_loopBlockedMs += gap;
  } else {
    g_loopWindowStart = now;
  }
  g_loopPrev = now;
}

// ---------------- Comandos por USB (diagnóstico) ----------------
static void printStatus() {
  const GpsSnap g = gpsSnapshot();
  Serial.println("\n---------------- STATUS ----------------");
  Serial.printf("WiFi:     %s  RSSI %d dBm  IP %s\n",
                WiFi.isConnected() ? "conectado" : "DESCONECTADO",
                WiFi.RSSI(), WiFi.localIP().toString().c_str());
  Serial.printf("Firebase: token %s, ultimo HTTP %d, heartbeat OK hace %lu s, notify %d\n",
                g_net.tokenOk ? "OK" : "SIN TOKEN", g_net.lastHttp,
                g_net.lastHeartbeatOkMs ? (unsigned long)((millis() - g_net.lastHeartbeatOkMs) / 1000) : 0UL,
                g_net.lastNotify);
  Serial.printf("GPS:      %s  sats %u  lat %.6f lng %.6f  (%lu chars recibidos)\n",
                locationSource(g), (unsigned)gps.satellites.value(),
                g.lat, g.lng, (unsigned long)gps.charsProcessed());
  Serial.printf("Bateria:  %d%%  (%lu mV)\n", g_net.batteryPct, (unsigned long)g_net.batteryMv);
  Serial.printf("MPU-6050: %s\n", g_mpuOk ? "OK" : "no detectado (caidas desactivadas)");
  Serial.printf("Ring:     poll cada %lu s\n", (unsigned long)(g_net.pollEveryMs / 1000));
  const uint32_t win = millis() - g_loopWindowStart;
  Serial.printf("Loop:     peor traba %lu ms, trabado %lu%% del tiempo (ultimos %lu s)\n",
                (unsigned long)g_loopMaxGap,
                (unsigned long)(win ? (100UL * g_loopBlockedMs / win) : 0),
                (unsigned long)(win / 1000));
  g_loopMaxGap = 0; g_loopBlockedMs = 0; g_loopWindowStart = millis();
  Serial.printf("Memoria:  %u bytes libres (minimo %u)   Uptime: %lu s\n",
                (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMinFreeHeap(),
                (unsigned long)(millis() / 1000));
  Serial.println("----------------------------------------");
}

// Lee la consola sin bloquear: junta caracteres hasta el fin de línea.
// (readStringUntil() espera hasta 1 s si la línea llega cortada.)
static String g_cmdBuf;
static void handleSerialCommand() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c != '\n' && c != '\r') {
      if (g_cmdBuf.length() < 32) g_cmdBuf += c;
      continue;
    }
    String cmd = g_cmdBuf;
    g_cmdBuf = "";
    cmd.trim();
    cmd.toUpperCase();
    if (cmd == "SOS") {
      raiseEmergency(REASON_PRUEBA);
    } else if (cmd == "STATUS") {
      printStatus();
    } else if (cmd == "RING") {
      buzzerRing(5);
      Serial.println("[RING] prueba local 5 s");
    } else if (cmd.length()) {
      Serial.println("Comandos: SOS (emergencia de prueba), STATUS, RING (pitido 5 s), AYUDA");
    }
  }
}

// ---------------- Botón (debounce) ----------------
static int g_btnStable = HIGH, g_btnLast = HIGH; static uint32_t g_btnChange = 0;
static bool buttonPressedEdge() {
  int r = digitalRead(PIN_BUTTON);
  if (r != g_btnLast) { g_btnChange = millis(); g_btnLast = r; }
  if (millis() - g_btnChange > 30 && r != g_btnStable) {
    g_btnStable = r;
    if (g_btnStable == LOW) return true;    // flanco de presión (activo LOW)
  }
  return false;
}

// ============================================================================
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== SafeWalk DevKit (firmware principal) ===");

  // Pines
  pinMode(PIN_HCSR04_TRIG, OUTPUT); pinMode(PIN_HCSR04_ECHO, INPUT);
  pinMode(PIN_BUZZER, OUTPUT); digitalWrite(PIN_BUZZER, LOW);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  ledcSetup(MOTOR_PWM_CHANNEL, MOTOR_PWM_FREQ, MOTOR_PWM_RES);
  ledcAttachPin(PIN_MOTOR, MOTOR_PWM_CHANNEL);
  ledcWrite(MOTOR_PWM_CHANNEL, 0);
  analogReadResolution(12);

  // Periféricos serie
  GPSserial.begin(GPS_BAUD, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
  CamLink.begin(CAM_LINK_BAUD, SERIAL_8N1, /*rx=*/-1, /*tx=*/PIN_CAM_TRIGGER);

  mpuInit();

  // Conectividad (bloqueante, pero es solo al arrancar)
  Serial.print("WiFi... ");  Serial.println(fb.beginWiFi(WIFI_SSID, WIFI_PASSWORD) ? "OK" : "FALLO");
  Serial.print("NTP...  ");  Serial.println(fb.syncTime() ? "OK" : "FALLO");
  Serial.print("Login.. ");  Serial.println(fb.signIn(FB_DEVICE_EMAIL, FB_DEVICE_PASSWORD) ? "OK" : "FALLO");

  // Toda la red pasa a su propia tarea en el núcleo 0 (el WiFi del ESP32 ya
  // vive ahí). 12 KB de stack: el handshake TLS + JSON + Strings lo necesitan.
  g_emergencyQ = xQueueCreate(4, sizeof(uint8_t));
  xTaskCreatePinnedToCore(netTask, "net", 12288, nullptr, 1, nullptr, 0);

  digitalWrite(PIN_BUZZER, HIGH); delay(80); digitalWrite(PIN_BUZZER, LOW);   // "listo"
}

void loop() {
  loopMetric();

  // --- Comandos por USB (SOS / STATUS / RING / AYUDA) ---
  handleSerialCommand();

  // --- GPS: consumir continuamente ---
  while (GPSserial.available()) gps.encode(GPSserial.read());
  if (gps.location.isUpdated() && gps.location.isValid()) {
    portENTER_CRITICAL(&g_gpsMux);
    g_gps.lat = gps.location.lat(); g_gps.lng = gps.location.lng();
    g_gps.speed = gps.speed.mps();  g_gps.hasFix = true; g_gps.fixAtMs = millis();
    portEXIT_CRITICAL(&g_gpsMux);
  }

  // --- Obstáculos (motor) ---
  if (millis() - g_lastUltra >= ULTRASONIC_INTERVAL_MS) {
    g_lastUltra = millis();
    long cm = readDistanceCm();
    updateObstacleMotor(cm);
  }

  // --- Pedidos de la red al buzzer ("encontrar el bastón") ---
  const int32_t ring = g_ringRequest.exchange(-1);
  if (ring == 0 && g_beep.isRing) buzzerStop();
  else if (ring > 0) buzzerRing((uint32_t)ring);

  // --- Resultado de la última alerta: avisar con el buzzer ---
  const int result = g_alertResult.exchange(0);
  if (result == 1) buzzerPattern(1, 400, 0);        // enviada
  else if (result == 2) buzzerPattern(5, 80, 80);   // NO se pudo enviar: volver a apretar

  updateBuzzer();

  // --- Botón de emergencia ---
  if (buttonPressedEdge()) raiseEmergency(REASON_BOTON);

  // --- Caída (INT de hardware) ---
  if (g_mpuOk && g_fallFlag) {
    g_fallFlag = false;
    if (mpuRd(REG_INT_STATUS) & 0x80) raiseEmergency(REASON_CAIDA);
  }
}
