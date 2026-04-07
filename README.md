# LTC Timecode Generator

**[Open the app](https://mrkva.github.io/Timecode-gen/)** — works on any phone or computer, installable as offline PWA.

A browser-based SMPTE LTC (Linear Timecode) generator. Designed to sync audio recorders (Tascam, Zoom, etc.) from a phone or computer — no dedicated hardware generator needed.

## How it works

The app generates a standard SMPTE LTC audio signal in real-time using the Web Audio API. The timecode is encoded as a biphase mark modulated waveform — the same format used by professional timecode generators.

1. The current wall-clock time is captured and converted to a frame count
2. Each frame is encoded as 80 LTC bits using the SMPTE bit mapping (BCD-encoded hours, minutes, seconds, frames + 16-bit sync word)
3. Bits are converted to audio using biphase mark encoding (transition at every bit boundary, additional mid-bit transition for 1s)
4. Audio is streamed continuously at 48 kHz mono

The signal is generated sample-by-sample on the audio thread (AudioWorklet on desktop, ScriptProcessorNode fallback on iOS) ensuring frame-accurate output with no gaps.

## Usage

Install as a PWA ("Add to Home Screen") for offline use. To self-host, serve the `docs/` folder over HTTPS.

### Setup

1. Connect your phone/computer audio output to your recorder's timecode input (TC IN / EXT IN)
   - Phone: use a USB-C DAC — the app outputs through whatever audio device the OS routes to
   - Computer: use any audio interface or headphone output
2. Open the app and configure:
   - **Frame rate** — must match your recorder's setting exactly (23.976, 24, 25, 29.97 DF, 30)
   - **Time zone** — defaults to your device's local timezone
   - **Volume** — start around 60%, adjust if the recorder won't lock (too loud = distortion, too quiet = no sync)
3. Tap **Start**
4. Your recorder should show "TC IN", "EXT LOCK", or similar within a few seconds

The timecode display runs continuously regardless of whether audio output is active.

## Accuracy and limitations

**Frame-to-frame timing is sample-perfect.** Once running, the audio is clocked by your DAC's crystal oscillator. There are no dropped or repeated frames.

**The initial timecode is seeded from your device's system clock**, which is typically accurate to a few milliseconds via NTP. This is a one-time offset — it does not affect ongoing frame accuracy.

**Long-term drift vs. wall clock:** The DAC's oscillator and your system clock will drift relative to each other over time (~20-100 ppm, or roughly 0.1-0.5 seconds per hour). This does not affect sync between devices reading the same LTC stream — they all lock to the same signal. It only means the displayed timecode may gradually diverge from your wall clock over very long sessions.

**This is not a precision time source.** Do not rely on it for applications requiring sub-millisecond wall-clock accuracy. For syncing multiple recorders to each other during a shoot, it works well. For syncing to an external reference clock, use dedicated hardware.

**iOS audio:** iOS Safari has limited Web Audio support. The app uses a ScriptProcessorNode fallback and plays a silent audio element to bypass the hardware mute switch. If you hear no sound, check that your volume is up and try toggling the silent switch.

## Python version

The original Python script (`timecode_gen.py`) generates LTC via `sounddevice` and `numpy`. It runs from the command line and requires a Python environment:

```
pip install sounddevice numpy
python timecode_gen.py
```

Configuration is hardcoded at the top of the file (sample rate, frame rate, volume, hour offset).

## Files

```
docs/               PWA (served by GitHub Pages)
  index.html         UI + audio engine
  ltc-worklet.js     AudioWorklet processor
  sw.js              Service worker (offline caching)
  manifest.json      PWA manifest
  icon-*.png         App icons

timecode_gen.py      Original Python implementation
```

## License

Do whatever you want with it.
