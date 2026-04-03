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
    this.nominalRate = 30;
    this.dropFrame = false;
    this.samplesPerBit = 0;
    this.samplesPerFrame = 0;
    this.lastReportedTC = '';

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'start') {
        this._applyFrameRate(msg.frameRate);
        this.volume = msg.volume;
        this.samplesPerBit = Math.floor(sampleRate / (this.nominalRate * 80));
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
          this._applyFrameRate(msg.frameRate);
          this.samplesPerBit = Math.floor(sampleRate / (this.nominalRate * 80));
          this.samplesPerFrame = this.samplesPerBit * 80;
        }
      }
    };
  }

  _applyFrameRate(rate) {
    this.frameRate = rate;
    this.dropFrame = false;
    // For 29.97 drop-frame: nominal rate is 30, but we skip frames
    // For 23.976: nominal rate is 24
    // For 29.97 NDF: nominal rate is 30, no drop
    if (rate === 29.97) {
      this.nominalRate = 30;
      this.dropFrame = true;
    } else if (rate === 23.976) {
      this.nominalRate = 24;
    } else {
      this.nominalRate = rate;
    }
  }

  _wallTimeToFrameCount(wallTimeMs, tzOffsetHours) {
    const d = new Date(wallTimeMs);
    const utcH = d.getUTCHours();
    const utcM = d.getUTCMinutes();
    const utcS = d.getUTCSeconds();
    const utcMs = d.getUTCMilliseconds();

    let totalSeconds = (utcH + tzOffsetHours) * 3600 + utcM * 60 + utcS;
    totalSeconds = ((totalSeconds % 86400) + 86400) % 86400;

    let totalFrames = totalSeconds * this.nominalRate +
      Math.floor(utcMs / (1000 / this.nominalRate));

    if (this.dropFrame) {
      // Convert real time to drop-frame count
      // In 29.97 DF, we drop frames 0 and 1 at the start of each minute
      // except every 10th minute
      const mins = Math.floor(totalSeconds / 60);
      const tenMins = Math.floor(mins / 10);
      totalFrames -= 2 * (mins - tenMins);
    }

    return totalFrames;
  }

  _frameCountToTC(count) {
    const maxFrames = 24 * 3600 * this.nominalRate;
    count = ((count % maxFrames) + maxFrames) % maxFrames;

    if (this.dropFrame) {
      // Drop-frame timecode conversion
      // 17982 frames per 10-minute block (29.97 DF)
      const D = Math.floor(count / 17982);
      const M = count % 17982;
      let f, s, m;
      if (M < 2) {
        // First two frames of a 10-minute block
        f = M;
        s = 0;
        m = 0;
      } else {
        // 1798 frames per minute (except first minute of 10-min block which has 1800)
        const adj = M - 2;
        const subMin = Math.floor(adj / 1798);
        const rem = adj % 1798;
        m = subMin + 1;
        if (rem < this.nominalRate - 2) {
          f = rem + 2;
          s = 0;
        } else {
          const rem2 = rem - (this.nominalRate - 2);
          s = Math.floor(rem2 / this.nominalRate) + 1;
          f = rem2 % this.nominalRate;
        }
      }
      const totalMin = D * 10 + m;
      const h = Math.floor(totalMin / 60) % 24;
      const mFinal = totalMin % 60;
      return { h, m: mFinal, s, f };
    }

    const f = count % this.nominalRate;
    const totalSec = Math.floor(count / this.nominalRate);
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

    // Drop frame flag (bit 10)
    if (this.dropFrame) {
      bits[10] = 1;
    }

    // Sync word (fixed 16-bit pattern)
    const sync = [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,1];
    for (let i = 0; i < 16; i++) bits[64 + i] = sync[i];

    return bits;
  }

  _generateWave(bits) {
    const samples = new Float32Array(this.samplesPerFrame);
    let idx = 0;

    for (let b = 0; b < 80; b++) {
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

    const sep = this.dropFrame ? ';' : ':';
    const tcStr = String(tc.h).padStart(2, '0') + ':' +
                  String(tc.m).padStart(2, '0') + ':' +
                  String(tc.s).padStart(2, '0') + sep +
                  String(tc.f).padStart(2, '0');
    if (tcStr !== this.lastReportedTC) {
      this.lastReportedTC = tcStr;
      this.port.postMessage({ type: 'timecode', tc: tcStr });
    }

    this.totalFrameCount++;
  }

  process(inputs, outputs) {
    if (!this.running) {
      return true;
    }

    const output = outputs[0][0];

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
