import {Emitter, LineFramer, parseLine} from './core.mjs';

export class SimulationTransport extends Emitter {
  constructor({now = () => performance.now(), seed = 5213, sampleRate = 200} = {}) {
    super(); this.now = now; this.seed = seed >>> 0; this.sampleRate = sampleRate; this.kind = 'simulation'; this.holding = false; this.pulseUntil = 0;
  }
  random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 0x100000000; }
  async start() {
    this.startPerf = this.now(); this.index = 0; this.missed = 0; this.level = 75;
    this.emit('message', {type: 'info', version: 1, sampleRate: this.sampleRate, channels: 1, adcMax: 1023, simulated: true});
    this.timer = setInterval(() => this.pump(), 10);
  }
  pump() {
    const current = this.now(), target = Math.floor((current - this.startPerf) * this.sampleRate / 1000);
    if (target - this.index > 40) { const skipped = target - this.index - 40; this.index += skipped; this.missed += skipped; }
    while (this.index < target) {
      this.index++;
      const deviceMs = this.index * 1000 / this.sampleRate;
      const pressed = this.holding || current < this.pulseUntil;
      const desired = pressed ? 620 : 75;
      this.level += (desired - this.level) * 0.12;
      const adc = Math.round(this.level + (this.random() - 0.5) * 8);
      this.emit('message', {type: 'sample', seq: this.index >>> 0, rawUs: Math.round(deviceMs * 1000) >>> 0, adc: [adc, null], missed: this.missed});
    }
  }
  setHold(value) { this.holding = !!value; }
  pulse(durationMs = 800) { this.pulseUntil = this.now() + durationMs; }
  async send() {}
  async stop() { clearInterval(this.timer); this.holding = false; this.emit('closed', {reason: 'operator_disconnect'}); }
}

export class SerialTransport extends Emitter {
  constructor({serial = globalThis.navigator?.serial} = {}) { super(); this.serial = serial; this.kind = 'serial'; this.stopping = false; this.writeQueue = Promise.resolve(); }
  async start() {
    if (!this.serial) throw new Error('Web Serial is unavailable. Use desktop Chrome or Edge for real Arduino input.');
    this.port = await this.serial.requestPort();
    await this.port.open({baudRate: 115200, bufferSize: 16384});
    this.reader = this.port.readable.getReader();
    this.readTask = this.readLoop();
    // UNO often resets on open. Request metadata repeatedly while it boots.
    this.infoTimer = setInterval(() => this.send('I').catch(() => {}), 700);
    await this.send('I');
  }
  async readLoop() {
    const decoder = new TextDecoder(), framer = new LineFramer();
    try {
      while (!this.stopping) {
        const {value, done} = await this.reader.read();
        if (done) break;
        for (const line of framer.push(decoder.decode(value, {stream: true}))) {
          try {
            const message = parseLine(line);
            if (message.type === 'info') clearInterval(this.infoTimer);
            this.emit('message', message);
          } catch (error) { this.emit('parse_error', {line: line.slice(0, 160), message: error.message}); }
        }
      }
    } catch (error) { if (!this.stopping) this.emit('error', error); }
    finally {
      try { this.reader.releaseLock(); } catch {}
      this.reader = null; clearInterval(this.infoTimer);
      this.emit('closed', {reason: this.stopping ? 'operator_disconnect' : 'serial_stream_ended'});
    }
  }
  send(command) {
    if (!/^(I|[PM],\d{1,10})$/.test(command)) return Promise.reject(new Error('Invalid serial command'));
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      if (!this.port?.writable || this.stopping) return;
      const writer = this.port.writable.getWriter();
      try { await writer.write(new TextEncoder().encode(command + '\n')); }
      finally { writer.releaseLock(); }
    });
    return this.writeQueue;
  }
  async stop() {
    this.stopping = true; clearInterval(this.infoTimer);
    try { await this.reader?.cancel(); } catch {}
    try { await this.readTask; } catch {}
    try { await this.writeQueue; } catch {}
    try { await this.port?.close(); } catch {}
    this.port = null;
  }
}
