/* BN5213 EMG envelope acquisition, UNO R3, protocol version 1.
   Default: one REAL channel A0. No external Arduino libraries.
   Set BN_EMG_SIMULATION to 1 ONLY for an explicitly labelled serial test.
   This records a sensor ENVELOPE, not raw bipolar EMG or muscle force.
   A0 must remain inside the actual UNO input supply range. This software
   does not provide electrical protection or body/USB isolation.

   115200 baud; 200 Hz. D,sequence,micros,adc0,adc1_or_-1,missed_slots
   Commands ending in newline: I; P,<numeric_id>; M,<numeric_id>.
   P replies include device receive/transmit times for estimated alignment.
   M records command receipt, NOT the physical display onset.
*/
#include <Arduino.h>
#include <stdlib.h>

#ifndef BN_EMG_SIMULATION
#define BN_EMG_SIMULATION 0
#endif
#ifndef BN_EMG_CHANNELS
#define BN_EMG_CHANNELS 1
#endif
#if BN_EMG_CHANNELS != 1 && BN_EMG_CHANNELS != 2
#error BN_EMG_CHANNELS must be 1 or 2
#endif

const uint32_t PERIOD_US = 5000UL;
uint32_t nextSampleUs = 0, sequence = 0, missedSlots = 0;
char commandBuffer[48];
uint8_t commandLength = 0;
bool commandOverflow = false;

void sendInfo() {
  Serial.print(F("I,BN5213,1,200,"));
  Serial.print(BN_EMG_CHANNELS);
  Serial.print(F(",1023,"));
#if BN_EMG_SIMULATION
  Serial.println(F("SIM"));
#else
  Serial.println(F("REAL"));
#endif
}

void handleCommand(uint32_t rxUs) {
  commandBuffer[commandLength] = '\0';
  if (commandLength == 1 && commandBuffer[0] == 'I') { sendInfo(); return; }
  if (commandLength < 3 || commandBuffer[1] != ',' || (commandBuffer[0] != 'P' && commandBuffer[0] != 'M')) {
    Serial.println(F("E,bad_command")); return;
  }
  for (uint8_t i = 2; i < commandLength; ++i) {
    if (commandBuffer[i] < '0' || commandBuffer[i] > '9') { Serial.println(F("E,bad_id")); return; }
  }
  const unsigned long id = strtoul(commandBuffer + 2, NULL, 10);
  if (id > 2147483647UL) { Serial.println(F("E,id_too_large")); return; }
  const uint32_t txUs = micros();
  Serial.print(commandBuffer[0]); Serial.print(','); Serial.print(id);
  Serial.print(','); Serial.print(rxUs);
  if (commandBuffer[0] == 'P') { Serial.print(','); Serial.print(txUs); }
  Serial.println();
}

void readCommands() {
  uint8_t budget = 32;
  while (budget-- && Serial.available() > 0) {
    const char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      if (!commandOverflow && commandLength) handleCommand(micros());
      else if (commandOverflow) Serial.println(F("E,line_too_long"));
      commandLength = 0; commandOverflow = false;
    } else if (!commandOverflow) {
      if (commandLength < sizeof(commandBuffer) - 1) commandBuffer[commandLength++] = c;
      else commandOverflow = true;
    }
  }
}

int readChannel(uint8_t pin, uint32_t nowUs) {
#if BN_EMG_SIMULATION
  (void)pin;
  const uint32_t phase = (nowUs / 1000UL) % 8000UL;
  const int noise = (int)((nowUs / PERIOD_US * 17UL) % 9UL) - 4;
  return 75 + noise + ((phase >= 5500UL && phase < 6500UL) ? 500 : 0);
#else
  (void)nowUs;
  return analogRead(pin);
#endif
}

void setup() {
  pinMode(A0, INPUT);
#if BN_EMG_CHANNELS == 2
  pinMode(A1, INPUT);
#endif
  analogReference(DEFAULT);
  Serial.begin(115200);
  sendInfo();
  nextSampleUs = micros();
}

void loop() {
  readCommands();
  const uint32_t nowUs = micros();
  if ((int32_t)(nowUs - nextSampleUs) < 0) return;
  const uint32_t skipped = (nowUs - nextSampleUs) / PERIOD_US;
  missedSlots += skipped;
  sequence += skipped + 1UL;
  nextSampleUs += (skipped + 1UL) * PERIOD_US;
  const int adc0 = readChannel(A0, nowUs);
  int adc1 = -1;
#if BN_EMG_CHANNELS == 2
  adc1 = readChannel(A1, nowUs); // Sequential ADC reads; channel 1 is later.
#endif
  Serial.print(F("D,")); Serial.print(sequence);
  Serial.print(','); Serial.print(nowUs);
  Serial.print(','); Serial.print(adc0);
  Serial.print(','); Serial.print(adc1);
  Serial.print(','); Serial.println(missedSlots);
}
