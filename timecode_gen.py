import numpy as np
import sounddevice as sd
import time
from datetime import datetime, timedelta

# --- CONFIGURATION ---
SAMPLE_RATE = 48000
FRAME_RATE = 30  # MUST match Tascam settings exactly (24, 25, 30, etc.)
VOLUME = 0.6     # Try 0.5 to 0.8. Too loud = distortion; too quiet = no sync.
HOUR_OFFSET = 0  # Adjust this (-1, 1, 2) if the hour is wrong.
# ---------------------

class LTCGenerator:
    def __init__(self):
        self.current_level = 1.0  # Maintains phase between frames
        
    def get_ltc_bits(self, h, m, s, f):
        bits = np.zeros(80, dtype=int)
        def set_bits(start, value, length):
            binary = format(value, f'0{length}b')[::-1]
            for i, bit in enumerate(binary):
                bits[start + i] = int(bit)

        # Standard SMPTE Bit Mapping
        set_bits(0, f % 10, 4)    # Frame units
        set_bits(8, f // 10, 2)   # Frame tens
        set_bits(16, s % 10, 4)   # Second units
        set_bits(24, s // 10, 3)  # Second tens
        set_bits(32, m % 10, 4)   # Minute units
        set_bits(40, m // 10, 3)  # Minute tens
        set_bits(48, h % 10, 4)   # Hour units
        set_bits(56, h // 10, 2)  # Hour tens
        
        # Sync Word (Fixed 16-bit pattern)
        bits[64:80] = [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,1]
        return bits

    def generate_wave(self, bits):
        samples_per_bit = SAMPLE_RATE / (FRAME_RATE * 80)
        wave = []
        
        for bit in bits:
            # Every bit starts with a transition (Biphase Mark)
            self.current_level *= -1
            if bit == 0:
                wave.extend([self.current_level] * int(samples_per_bit))
            else:
                half = int(samples_per_bit / 2)
                wave.extend([self.current_level] * half)
                self.current_level *= -1
                wave.extend([self.current_level] * (int(samples_per_bit) - half))
        return np.array(wave, dtype=np.float32)

def run():
    gen = LTCGenerator()
    print(f"LTC Generator Running | {FRAME_RATE} FPS | {SAMPLE_RATE}Hz")
    print("Check Tascam for 'TC IN' or 'EXT LOCK' icon.")
    print("--------------------------------------------------")

    with sd.OutputStream(samplerate=SAMPLE_RATE, channels=1) as stream:
        while True:
            # Get high-precision system time
            now = datetime.now() + timedelta(hours=HOUR_OFFSET)
            frame = int(now.microsecond / (1_000_000 / FRAME_RATE))
            
            # Console Readout: Verify this matches your wall clock!
            timestamp = now.strftime('%H:%M:%S') + f":{frame:02d}"
            print(f"\rSending: {timestamp} ", end="", flush=True)
            
            bits = gen.get_ltc_bits(now.hour, now.minute, now.second, frame)
            audio_data = gen.generate_wave(bits) * VOLUME
            
            stream.write(audio_data)

if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        print("\nStopped.")