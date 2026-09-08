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
//  Flujo de ENCONTRAR EL BASTON (la app le pide al baston que suene):
//    1) la app escribe commands/{deviceId} con un ringToken nuevo + ringSeconds
//    2) el DevKit lee ese doc cada RING_POLL_INTERVAL_MS (unico camino de
//       LECTURA del firmware: todo lo demas es escritura)
//    3) si el token cambio, hace pitar el buzzer en rafagas, sin bloquear el loop
//    4) escribe ackToken de vuelta para que la app pueda decirle al usuario
//       que el baston SI recibio la orden (el usuario ciego no puede mirarlo)
//
//  Flujo de EMERGENCIA (botón o caída):
//    1) buzzer avisa
//    2) DevKit crea alerts/{alertId} con ubicación (photoUrl/audioUrl vacíos, seen=false)
//    3) DevKit manda "ALERT|<alertId>" al ESP32-CAM
//    4) el ESP32-CAM saca foto + graba 15s de audio, sube ambos a Storage y
//       completa photoUrl/audioUrl en el mismo doc (PATCH).
//
//  >>> AJUSTAR <<< credenciales en include/secrets.h y deviceId en config.h.
// ============================================================================
#include <Arduino.h>
#include <Wire.h>
#include <TinyGPSPlus.h>
#include <ArduinoJson.h>
#include "config.h"
#include "FirebaseRest.h"

// ---------------- Objetos globales ----------------
FirebaseRest   fb;
TinyGPSPlus    gps;
HardwareSerial GPSserial(2);   // UART2 (GPS)
HardwareSerial CamLink(1);     // UART1 (hacia ESP32-CAM, solo TX en GPIO13)

// ---------------- Estado ----------------
double  g_lat = -34.6037, g_lng = -58.3816;  // última ubicación conocida (default Obelisco)
double  g_speed = 0.0;
bool    g_hasFix = false;
uint32_t g_lastHeartbeat = 0, g_lastHistory = 0, g_lastUltra = 0;

// ---------------- MPU-6050 (registros) ----------------
#define REG_PWR_MGMT_1 0x6B
#define REG_ACCEL_CONFIG 0x1C
#define REG_FF_THR 0x1D
#define REG_FF_DUR 0x1E
#define REG_INT_PIN_CFG 0x37
#define REG_INT_ENABLE 0x38
#define REG_INT_STATUS 0x3A

volatile bool g_fallFlag = false;
void IRAM_ATTR onMpuInt() { g_fallFlag = true; }

static void mpuWr(uint8_t r, uint8_t v) {
  Wire.beginTransmission(MPU_I2C_ADDR); Wire.write(r); Wire.write(v); Wire.endTransmission();
}
static uint8_t mpuRd(uint8_t r) {
  Wire.beginTransmission(MPU_I2C_ADDR); Wire.write(r); Wire.endTransmission(false);
  Wire.requestFrom((int)MPU_I2C_ADDR, 1); return Wire.read();
}
static void mpuInit() {
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
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

// ---------------- Buzzer (feedback) ----------------
static void beep(uint16_t ms) { digitalWrite(PIN_BUZZER, HIGH); delay(ms); digitalWrite(PIN_BUZZER, LOW); }
static void beepPattern(int n, uint16_t on, uint16_t off) {
  for (int i = 0; i < n; i++) { beep(on); delay(off); }
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
static uint32_t  g_lastRingPoll   = 0;
static uint32_t  g_ringUntilMs    = 0;   // 0 = no está sonando
static uint32_t  g_ringNextToggle = 0;
static bool      g_ringBuzzerOn   = false;
static int       g_ringBeepCount  = 0;

static void ringStop() {
  g_ringUntilMs   = 0;
  g_ringBuzzerOn  = false;
  g_ringBeepCount = 0;
  digitalWrite(PIN_BUZZER, LOW);
}

// Pitido NO bloqueante (mismo patrón que el motor de obstáculos): si usáramos
// delay() acá, el bastón dejaría de detectar obstáculos mientras suena.
static void updateRingBuzzer() {
  if (g_ringUntilMs == 0) return;

  const uint32_t now = millis();
  if ((int32_t)(now - g_ringUntilMs) >= 0) {      // se cumplió el tiempo pedido
    ringStop();
    Serial.println("[RING] fin");
    return;
  }
  if ((int32_t)(now - g_ringNextToggle) < 0) return;

  if (g_ringBuzzerOn) {
    digitalWrite(PIN_BUZZER, LOW);
    g_ringBuzzerOn = false;
    g_ringBeepCount++;
    // Pausa larga cada RING_BEEP_GROUP pitidos: el silencio es justamente lo
    // que deja ubicar de dónde viene el sonido.
    const bool endOfGroup = (g_ringBeepCount % RING_BEEP_GROUP) == 0;
    g_ringNextToggle = now + (endOfGroup ? RING_GROUP_PAUSE_MS : RING_BEEP_OFF_MS);
  } else {
    digitalWrite(PIN_BUZZER, HIGH);
    g_ringBuzzerOn = true;
    g_ringNextToggle = now + RING_BEEP_ON_MS;
  }
}

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

static void pollRingCommand() {
  String json;
  if (!fb.firestoreGet(FS_COMMANDS_DOC, json)) return;  // 404 = todavía no hay órdenes

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
    ringStop();
    Serial.println("[RING] parar (pedido de la app)");
    ringAck(token);
    return;
  }
  // Tope propio: no confiamos en el número que mandó la app. Un bug o un reloj
  // raro del lado del celular no puede dejar el buzzer sonando para siempre.
  if (secs > RING_MAX_SECONDS) secs = RING_MAX_SECONDS;

  const uint32_t now = millis();
  g_ringUntilMs    = now + (uint32_t)secs * 1000UL;
  g_ringNextToggle = now;                 // que arranque a pitar ya
  g_ringBeepCount  = 0;
  Serial.printf("[RING] sonando %ld s\n", secs);
  ringAck(token);
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
static int readBatteryPercent() {
  uint32_t acc = 0; const int N = 16;
  for (int i = 0; i < N; i++) acc += analogReadMilliVolts(PIN_BATTERY);
  float mv = (acc / (float)N) * BATT_DIVIDER_RATIO;
  float pct = (mv - BATT_EMPTY_MV) / (BATT_FULL_MV - BATT_EMPTY_MV) * 100.0f;
  return (int)constrain(pct, 0.0f, 100.0f);
}

// ---------------- EMERGENCIA ----------------
static void triggerEmergency(const char* reason) {
  Serial.printf("\n*** EMERGENCIA (%s) ***\n", reason);
  ringStop();                               // la emergencia se queda con el buzzer
  beepPattern(3, 120, 100);                 // aviso sonoro

  String alertId = String(SAFEWALK_DEVICE_ID) + "_" + FirebaseRest::isoTimestampNow();
  alertId.replace(":", "-");                // ':' no es válido en ids/paths

  // 1) Crear el doc de alerta con la ubicación (las URLs las completa el CAM)
  String fields =
      "\"deviceId\":"  + FirebaseRest::fStr(SAFEWALK_DEVICE_ID) +
      ",\"timestamp\":" + FirebaseRest::fTimestamp(FirebaseRest::isoTimestampNow()) +
      ",\"location\":"  + FirebaseRest::fGeo(g_lat, g_lng) +
      ",\"photoUrl\":"  + FirebaseRest::fStr("") +
      ",\"audioUrl\":"  + FirebaseRest::fStr("") +
      ",\"seen\":"      + FirebaseRest::fBool(false);
  bool ok = fb.firestoreSet(String(FS_ALERTS_COLL) + "/" + alertId, fields);
  Serial.printf("Alerta creada: %s (%s)\n", alertId.c_str(), ok ? "OK" : "FALLO");

  // 2) Avisar al ESP32-CAM que capture foto + audio para este alertId
  CamLink.printf("ALERT|%s\n", alertId.c_str());

  beep(400);                                // confirmación "alerta enviada"
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

  // Conectividad
  Serial.print("WiFi... ");  Serial.println(fb.beginWiFi(WIFI_SSID, WIFI_PASSWORD) ? "OK" : "FALLO");
  Serial.print("NTP...  ");  Serial.println(fb.syncTime() ? "OK" : "FALLO");
  Serial.print("Login.. ");  Serial.println(fb.signIn(FB_DEVICE_EMAIL, FB_DEVICE_PASSWORD) ? "OK" : "FALLO");

  beep(80);   // "listo"
}

void loop() {
  // --- GPS: consumir continuamente ---
  while (GPSserial.available()) gps.encode(GPSserial.read());
  if (gps.location.isValid()) {
    g_lat = gps.location.lat(); g_lng = gps.location.lng();
    g_speed = gps.speed.mps();  g_hasFix = true;
  }

  // --- Obstáculos (motor) ---
  if (millis() - g_lastUltra >= ULTRASONIC_INTERVAL_MS) {
    g_lastUltra = millis();
    long cm = readDistanceCm();
    updateObstacleMotor(cm);
  }

  // --- Encontrar el bastón: el pitido corre siempre, el poll cada tanto ---
  updateRingBuzzer();
  if (millis() - g_lastRingPoll >= RING_POLL_INTERVAL_MS) {
    g_lastRingPoll = millis();
    pollRingCommand();                      // OJO: bloquea ~1 s (handshake TLS)
  }

  // --- Botón de emergencia ---
  if (buttonPressedEdge()) triggerEmergency("boton");

  // --- Caída (INT de hardware) ---
  if (g_fallFlag) {
    g_fallFlag = false;
    if (mpuRd(REG_INT_STATUS) & 0x80) triggerEmergency("caida");
  }

  // --- Heartbeat: devices/{id} ---
  if (millis() - g_lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
    g_lastHeartbeat = millis();
    String fields =
        "\"batteryLevel\":" + FirebaseRest::fInt(readBatteryPercent()) +
        ",\"isOnline\":"    + FirebaseRest::fBool(true) +
        ",\"lastSeen\":"    + FirebaseRest::fTimestamp(FirebaseRest::isoTimestampNow()) +
        ",\"location\":"    + FirebaseRest::fGeo(g_lat, g_lng) +
        ",\"speed\":"       + FirebaseRest::fDouble(g_speed);
    fb.firestoreSet(FS_DEVICE_DOC, fields);
  }

  // --- Historial: locations/{id}/history ---
  if (g_hasFix && millis() - g_lastHistory >= HISTORY_INTERVAL_MS) {
    g_lastHistory = millis();
    String fields =
        "\"lat\":"       + FirebaseRest::fDouble(g_lat) +
        ",\"lng\":"      + FirebaseRest::fDouble(g_lng) +
        ",\"timestamp\":" + FirebaseRest::fTimestamp(FirebaseRest::isoTimestampNow());
    fb.firestoreAdd(FS_HISTORY_COLL, fields);
  }
}
