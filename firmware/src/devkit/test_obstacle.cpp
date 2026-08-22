// ============================================================================
//  TEST COMBINADO - OBSTACULO   (corre en: ESP32 DevKit v1)   env: test_obstacle
//  ----------------------------------------------------------------------------
//  Prueba el flujo REAL de detección de obstáculos, igual que el firmware
//  principal (updateObstacleMotor) pero SIN WiFi/Firebase:
//
//    HC-SR04 (GPIO26 TRIG / GPIO25 ECHO)  ->  mide distancia
//    Motor   (GPIO27 vía BC547 + PWM)     ->  vibra: cerca = fuerte y rápido
//    Buzzer  (GPIO2  vía BC547)           ->  pita en sincro con la vibración
//
//  Comportamiento:
//   - Sin obstáculo dentro de OBSTACLE_MAX_CM  -> motor y buzzer APAGADOS.
//   - Con obstáculo: cuanto MÁS CERCA, MÁS fuerte la vibración (duty) y MÁS
//     rápido el pulso (motor y buzzer prenden/apagan juntos).
//
//  Sirve aunque tengas conectado SOLO el motor o SOLO el buzzer.
//  Acercá la mano al sensor y mirá el serial + sentí/escuchá los actuadores.
// ============================================================================
#include <Arduino.h>
#include "config.h"

// Devuelve distancia en cm, o -1 si no hubo eco (timeout / fuera de rango).
static long readDistanceCm() {
  digitalWrite(PIN_HCSR04_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_HCSR04_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_HCSR04_TRIG, LOW);
  unsigned long us = pulseIn(PIN_HCSR04_ECHO, HIGH, 25000UL);
  if (us == 0) return -1;
  return (long)(us / 58);
}

// Estado del pulso (no bloqueante) del motor+buzzer.
static uint32_t g_nextToggle = 0;
static bool     g_on = false;

void setup() {
  Serial.begin(115200);

  // HC-SR04
  pinMode(PIN_HCSR04_TRIG, OUTPUT);
  pinMode(PIN_HCSR04_ECHO, INPUT);
  digitalWrite(PIN_HCSR04_TRIG, LOW);

  // Buzzer (arranca callado; GPIO2 es strapping)
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  // Motor por PWM (LEDC)
  ledcSetup(MOTOR_PWM_CHANNEL, MOTOR_PWM_FREQ, MOTOR_PWM_RES);
  ledcAttachPin(PIN_MOTOR, MOTOR_PWM_CHANNEL);
  ledcWrite(MOTOR_PWM_CHANNEL, 0);

  Serial.println("\n[TEST OBSTACULO] HC-SR04 + motor + buzzer.");
  Serial.printf("Rango de alerta: %d..%d cm. Acerca la mano al sensor.\n",
                OBSTACLE_MIN_CM, OBSTACLE_MAX_CM);
}

void loop() {
  // --- medir cada ULTRASONIC_INTERVAL_MS e imprimir ---
  static uint32_t lastMeas = 0;
  static long cm = -1;
  if (millis() - lastMeas >= ULTRASONIC_INTERVAL_MS) {
    lastMeas = millis();
    cm = readDistanceCm();
    if (cm < 0)      Serial.println("Distancia: sin eco (lejos / fuera de rango)");
    else             Serial.printf("Distancia: %ld cm%s\n", cm,
                                   (cm <= OBSTACLE_MAX_CM) ? "  <-- OBSTACULO" : "");
  }

  // --- sin obstáculo cercano -> apagar todo ---
  if (cm < 0 || cm > OBSTACLE_MAX_CM) {
    if (g_on) {
      ledcWrite(MOTOR_PWM_CHANNEL, 0);
      digitalWrite(PIN_BUZZER, LOW);
      g_on = false;
    }
    return;
  }

  // --- con obstáculo: intensidad y cadencia según cercanía ---
  long c   = constrain(cm, (long)OBSTACLE_MIN_CM, (long)OBSTACLE_MAX_CM);
  int duty   = map(c, OBSTACLE_MIN_CM, OBSTACLE_MAX_CM, 255, 90);   // cerca=255, lejos=90
  int period = map(c, OBSTACLE_MIN_CM, OBSTACLE_MAX_CM, 80, 600);   // cerca=80ms, lejos=600ms

  uint32_t now = millis();
  if (now >= g_nextToggle) {
    g_on = !g_on;
    ledcWrite(MOTOR_PWM_CHANNEL, g_on ? duty : 0);   // motor
    digitalWrite(PIN_BUZZER, g_on ? HIGH : LOW);     // buzzer en sincro
    g_nextToggle = now + period;
  }
}
