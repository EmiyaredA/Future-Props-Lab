export function playPetTone(kind: "none" | "tap" | "chime") {
  if (kind === "none") return;
  let audio: AudioContext;
  try {
    audio = new AudioContext();
  } catch {
    return;
  }
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = kind === "tap" ? 520 : 760;
  gain.gain.setValueAtTime(0.06, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.18);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + 0.18);
  oscillator.onended = () => {
    void audio.close();
  };
}
