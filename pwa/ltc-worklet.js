// LTC Timecode AudioWorklet Processor
// Generates SMPTE LTC audio in real-time on the audio thread

class LTCProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.currentLevel = 1.0;
    this.frameBuffer = null;
    this.frameBufferIndex = 0;
    this.totalFrameCount = 0;
    this.running = false;
    this.volume = 0.6;
    this.frameRate = 30;
    this.samplesPerBit = 0;
    this.samplesPerFrame = 0;
    this.lastReportedTC = '';

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'start') {
        this.frameRate = msg.frameRate;
        this.volume = msg.volume;
        this.samplesPerBit = Math.floor(sampleRate / (this.frameRate * 80));
        this.samplesPerFrame = this.samplesPerBit * 80;
        this.totalFrameCount = this._wallTimeToFrameCount(msg.wallTimeMs, msg.tzOffsetHours);
        this.frameBuffer = null;
        this.frameBufferIndex = 0;
        this.currentLevel = 1.0;
        this.running = true;
      } else if (msg.type === 'stop') {
        this.running = false;
      } else if (msg.type === 'config') {
        if (msg.volume !== undefined) this.volume = msg.volume;
        if (msg.frameRate !== undefined) {
          this.frameRate = msg.frameRate;
          this.samplesPerBit = Math.floor(sampleRate / (this.frameRate * 80));
          this.samplesPerFrame = this.samplesPerBit * 80;
        }
      }
    };
  }

  _wallTimeToFrameCount(wallTimeMs, tzOffsetHours) {
    const d = new Date(wallTimeMs);
    // Apply timezone offset: convert UTC to desired timezone
    const utcH = d.getUTCHours();
    const utcM = d.getUTCMinutes();
    const utcS = d.getUTCSeconds();
    const utcMs = d.getUTCMilliseconds();

    let totalSeconds = (utcH + tzOffsetHours) * 3600 + utcM * 60 + utcS;
    // Wrap around midnight
    totalSeconds = ((totalSeconds % 86400) + 86400) % 86400;

    const totalFrames = totalSeconds * this.frameRate +
      Math.floor(utcMs / (1000 / this.frameRate));
    return totalFrames;
  }

  _frameCountToTC(count) {
    // Wrap at 24 hours worth of frames
    const maxFrames = 24 * 3600 * this.frameRate;
    count = ((count % maxFrames) + maxFrames) % maxFrames;

    const f = count % this.frameRate;
    const totalSec = Math.floor(count / this.frameRate);
    const s = totalSec % 60;
    const totalMin = Math.floor(totalSec / 60);
    const m = totalMin % 60;
    const h = Math.floor(totalMin / 60) % 24;
    return { h, m, s, f };
  }

  _getLtcBits(h, m, s, f) {
    const bits = new Uint8Array(80);

    const setBits = (start, value, length) => {
      for (let i = 0; i < length; i++) {
        bits[start + i] = (value >> i) & 1;
      }
    };

    // Standard SMPTE Bit Mapping
    setBits(0, f % 10, 4);              // Frame units
    setBits(8, Math.floor(f / 10), 2);  // Frame tens
    setBits(16, s % 10, 4);             // Second units
    setBits(24, Math.floor(s / 10), 3); // Second tens
    setBits(32, m % 10, 4);             // Minute units
    setBits(40, Math.floor(m / 10), 3); // Minute tens
    setBits(48, h % 10, 4);             // Hour units
    setBits(56, Math.floor(h / 10), 2); // Hour tens

    // Sync word (fixed 16-bit pattern)
    const sync = [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,1];
    for (let i = 0; i < 16; i++) bits[64 + i] = sync[i];

    return bits;
  }

  _generateWave(bits) {
    const samples = new Float32Array(this.samplesPerFrame);
    let idx = 0;

    for (let b = 0; b < 80; b++) {
      // Every bit starts with a transition (Biphase Mark)
      this.currentLevel *= -1;

      if (bits[b] === 0) {
        for (let i = 0; i < this.samplesPerBit; i++) {
          samples[idx++] = this.currentLevel;
        }
      } else {
        const half = Math.floor(this.samplesPerBit / 2);
        for (let i = 0; i < half; i++) {
          samples[idx++] = this.currentLevel;
        }
        this.currentLevel *= -1;
        for (let i = 0; i < this.samplesPerBit - half; i++) {
          samples[idx++] = this.currentLevel;
        }
      }
    }

    return samples;
  }

  _generateNextFrame() {
    const tc = this._frameCountToTC(this.totalFrameCount);
    const bits = this._getLtcBits(tc.h, tc.m, tc.s, tc.f);
    this.frameBuffer = this._generateWave(bits);
    this.frameBufferIndex = 0;

    // Report timecode to main thread (throttled to once per frame)
    const tcStr = String(tc.h).padStart(2, '0') + ':' +
                  String(tc.m).padStart(2, '0') + ':' +
                  String(tc.s).padStart(2, '0') + ':' +
                  String(tc.f).padStart(2, '0');
    if (tcStr !== this.lastReportedTC) {
      this.lastReportedTC = tcStr;
      this.port.postMessage({ type: 'timecode', tc: tcStr });
    }

    this.totalFrameCount++;
  }

  process(inputs, outputs) {
    if (!this.running) {
      return true; // Keep alive but output silence
    }

    const output = outputs[0][0]; // Mono channel

    for (let i = 0; i < output.length; i++) {
      if (!this.frameBuffer || this.frameBufferIndex >= this.frameBuffer.length) {
        this._generateNextFrame();
      }
      output[i] = this.frameBuffer[this.frameBufferIndex++] * this.volume;
    }

    return true;
  }
}

registerProcessor('ltc-processor', LTCProcessor);
