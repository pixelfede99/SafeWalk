// ============================================================================
//  TEST - "ENCONTRAR EL BASTON" (patron de pitido)  ESP32 DevKit v1
//  env: test_ring
//  ----------------------------------------------------------------------------
//  Prueba SOLO el patron de sonido con el que el baston se hace encontrar,
//  sin WiFi ni Firebase. Sirve para dos cosas concretas:
//
//    1) Verificar que se escucha de verdad. Es la funcion entera: el GPS no
//       encuentra un baston adentro de una casa (no hay fix), asi que lo unico
//       que lo encuentra es el oido. Probalo desde otra habitacion, con la
//       puerta cerrada, y con el baston tapado por una campera o abajo de un
//       sillon, que es como se pierde en la vida real.
//
//    2) Ajustar el patron. Los pitidos van en grupos con una pausa larga en el
//       medio a proposito: el silencio es lo que deja ubicar de donde viene el
//       sonido. Un pitido continuo es mucho mas dificil de localizar.
//       Para cambiarlo, tocá RING_BEEP_* / RING_GROUP_PAUSE_MS en config.h.
//
//  Hardware: el mismo del test_buzzer (GPIO2 -> R 1k -> base BC547).
//  Esperado: 10 s de pitidos en grupos de 3, despues 5 s de silencio, y repite.
//            El "tick" del serial cada 1 s demuestra que el patron NO bloquea
//            el loop (en el firmware real, mientras suena se sigue midiendo
//            obstaculos).
// ============================================================================
#include <Arduino.h>
#include "config.h"

#define TEST_RING_SECONDS   10
#define TEST_PAUSE_MS     5000UL

static uint32_t g_ringUntilMs    = 0;
static uint32_t g_ringNextToggle = 0;
static bool     g_ringBuzzerOn   = false;
static int      g_ringBeepCount  = 0;

static void ringStop() {
  g_ringUntilMs   = 0;
  g_ringBuzzerOn  = false;
  g_ringBeepCount = 0;
  digitalWrite(PIN_BUZZER, LOW);
}

static void ringStart(uint16_t seconds) {
  const uint32_t now = millis();
  g_ringUntilMs    = now + (uint32_t)seconds * 1000UL;
  g_ringNextToggle = now;   // "ya" es millis(), no 0: con 0 se rompe en el wrap
  g_ringBeepCount  = 0;
}

// Copia exacta de la logica de devkit_main.cpp: si cambias una, cambia la otra.
static void updateRingBuzzer() {
  if (g_ringUntilMs == 0) return;

  const uint32_t now = millis();
  if ((int32_t)(now - g_ringUntilMs) >= 0) { ringStop(); return; }
  if ((int32_t)(now - g_ringNextToggle) < 0) return;

  if (g_ringBuzzerOn) {
    digitalWrite(PIN_BUZZER, LOW);
    g_ringBuzzerOn = false;
    g_ringBeepCount++;
    const bool endOfGroup = (g_ringBeepCount % RING_BEEP_GROUP) == 0;
    g_ringNextToggle = now + (endOfGroup ? RING_GROUP_PAUSE_MS : RING_BEEP_OFF_MS);
  } else {
    digitalWrite(PIN_BUZZER, HIGH);
    g_ringBuzzerOn = true;
    g_ringNextToggle = now + RING_BEEP_ON_MS;
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);   // arranca callado (GPIO2 es strapping)
  Serial.println("\n[TEST RING] Patron de 'encontrar el baston'.");
  Serial.printf("Grupos de %d pitidos de %d ms, pausa de %d ms entre grupos.\n",
                RING_BEEP_GROUP, RING_BEEP_ON_MS, RING_GROUP_PAUSE_MS);
  Serial.println("Alejate y fijate si podes ubicarlo de oido.");
  ringStart(TEST_RING_SECONDS);
}

void loop() {
  updateRingBuzzer();

  // Prueba de que el patron no bloquea: este tick sigue saliendo cada 1 s.
  static uint32_t lastTick = 0;
  if (millis() - lastTick >= 1000) {
    lastTick = millis();
    Serial.println(g_ringUntilMs ? "  sonando... (loop libre)" : "  silencio");
  }

  // Cuando termina la tanda, espera y arranca de nuevo.
  static uint32_t restartAt = 0;
  if (g_ringUntilMs == 0 && restartAt == 0) restartAt = millis() + TEST_PAUSE_MS;
  if (restartAt && millis() >= restartAt) {
    restartAt = 0;
    Serial.println("[TEST RING] otra vuelta");
    ringStart(TEST_RING_SECONDS);
  }
}
