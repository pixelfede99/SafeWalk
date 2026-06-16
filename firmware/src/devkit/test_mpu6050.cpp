// ============================================================================
//  TEST 5 - MPU-6050 + CAIDA LIBRE POR INT   (ESP32 DevKit v1)  env: test_mpu6050
//  ----------------------------------------------------------------------------
//  I2C: SDA=GPIO21, SCL=GPIO22, dirección 0x68 (AD0 a GND).
//  INT del MPU -> GPIO34 (input-only). Configuramos la detección de CAIDA LIBRE
//  por HARDWARE (registros FF_THR / FF_DUR / INT_ENABLE.FF_EN) para que el MPU
//  levante el pin INT solo. En la ISR marcamos un flag; el loop lo confirma.
//
//  Trabajo a registro (sin librería) para tener control fino del INT de free-fall.
//
//  Esperado:
//   - imuestra acelerómetro en g (~1g en reposo en un eje).
//   - si lo dejás caer (o simulás caída libre), imprime ">> CAIDA DETECTADA".
//
//  AJUSTE: FF_THR y FF_DUR hay que calibrarlos en el bastón real (sensibilidad).
// ============================================================================
#include <Arduino.h>
#include <Wire.h>
#include "config.h"

// Registros MPU-6050
#define REG_PWR_MGMT_1   0x6B
#define REG_ACCEL_CONFIG 0x1C
#define REG_FF_THR       0x1D
#define REG_FF_DUR       0x1E
#define REG_INT_PIN_CFG  0x37
#define REG_INT_ENABLE   0x38
#define REG_INT_STATUS   0x3A
#define REG_ACCEL_XOUT_H 0x3B

volatile bool g_freefallFlag = false;
void IRAM_ATTR onMpuInt() { g_freefallFlag = true; }

static void wr(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_I2C_ADDR);
  Wire.write(reg); Wire.write(val);
  Wire.endTransmission();
}
static uint8_t rd(uint8_t reg) {
  Wire.beginTransmission(MPU_I2C_ADDR);
  Wire.write(reg); Wire.endTransmission(false);
  Wire.requestFrom((int)MPU_I2C_ADDR, 1);
  return Wire.read();
}

static void readAccelG(float& gx, float& gy, float& gz) {
  Wire.beginTransmission(MPU_I2C_ADDR);
  Wire.write(REG_ACCEL_XOUT_H); Wire.endTransmission(false);
  Wire.requestFrom((int)MPU_I2C_ADDR, 6);
  int16_t ax = (Wire.read() << 8) | Wire.read();
  int16_t ay = (Wire.read() << 8) | Wire.read();
  int16_t az = (Wire.read() << 8) | Wire.read();
  // ±2g -> 16384 LSB/g
  gx = ax / 16384.0f; gy = ay / 16384.0f; gz = az / 16384.0f;
}

void setup() {
  Serial.begin(115200);
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);

  wr(REG_PWR_MGMT_1, 0x00);     // despertar
  delay(100);
  wr(REG_ACCEL_CONFIG, 0x00);   // ±2g

  // --- Configuración de CAIDA LIBRE (free-fall) ---
  wr(REG_FF_THR, 0x20);         // umbral de aceleración (tunable) ~ < ~0.25g
  wr(REG_FF_DUR, 0x28);         // duración mínima en free-fall (tunable) ~40 ms
  wr(REG_INT_PIN_CFG, 0x00);    // INT activo-HIGH, push-pull, pulso corto
  wr(REG_INT_ENABLE, 0x80);     // FF_EN: habilita interrupción por free-fall

  pinMode(PIN_MPU_INT, INPUT);  // GPIO34 input-only (sin pull; lo maneja el MPU)
  attachInterrupt(digitalPinToInterrupt(PIN_MPU_INT), onMpuInt, RISING);

  rd(REG_INT_STATUS);           // limpia cualquier flag inicial
  Serial.println("\n[TEST MPU-6050] Acelerometro + INT de caida libre listo.");
}

void loop() {
  if (g_freefallFlag) {
    g_freefallFlag = false;
    uint8_t st = rd(REG_INT_STATUS);   // leer limpia el INT
    if (st & 0x80) {                   // bit FF
      Serial.println(">> CAIDA DETECTADA (free-fall INT)");
    }
  }

  static uint32_t last = 0;
  if (millis() - last > 500) {
    last = millis();
    float gx, gy, gz;
    readAccelG(gx, gy, gz);
    Serial.printf("accel  x=%.2f  y=%.2f  z=%.2f  |g|=%.2f\n",
                  gx, gy, gz, sqrtf(gx*gx + gy*gy + gz*gz));
  }
}
