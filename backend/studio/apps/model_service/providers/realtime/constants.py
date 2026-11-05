SENSEAUDIO_REALTIME_URL = "wss://api.senseaudio.cn/ws/v1/realtime/voice-dialog"
SENSEAUDIO_REALTIME_MODEL = "senseaudio-realtime-1.0"

VOICE_INPUT_SAMPLE_RATE = 16_000
VOICE_OUTPUT_SAMPLE_RATE = 24_000
VOICE_COMMIT_SILENCE_MS = 400
VOICE_INSTRUCTIONS_MAX_CHARS = 20_000
VOICE_GREETING_MAX_CHARS = 2_000

VOICE_VAD_POSITIVE_THRESHOLD = 0.55
VOICE_VAD_NEGATIVE_THRESHOLD = 0.38
VOICE_VAD_MIN_SPEECH_MS = 320
VOICE_VAD_PRE_SPEECH_PAD_MS = 160
VOICE_PLAYBACK_START_BUFFER_MS = 400
VOICE_PLAYBACK_RECOVERY_BUFFER_MS = 800

SENSEAUDIO_PCM_FRAME_BYTES = 1280
SENSEAUDIO_PCM_FRAME_SECONDS = 0.04
SENSEAUDIO_PCM_SILENCE_FRAME = bytes(SENSEAUDIO_PCM_FRAME_BYTES)
SENSEAUDIO_UPLINK_QUEUE_FRAMES = 250

SENSEAUDIO_DEFAULT_VOICE = "f_m_0009_a"
SENSEAUDIO_VOICE_PRESETS: tuple[tuple[str, str], ...] = (
    ("m_c_0001", "可爱萌娃 · 开心"),
    ("f_y_0035_a", "清风少女 · 傲娇"),
    ("f_y_0035_c", "清风少女 · 平稳"),
    ("f_y_0039_c", "知心少女 · 广告中插"),
    ("f_y_0039_d", "知心少女 · 轻松铺陈"),
    ("f_y_0037_f", "青春女声 · 主题升华"),
    ("f_y_0041_c", "亲切女孩 · 致歉安慰"),
    ("m_y_0022", "沙哑青年 · 深情"),
    ("m_y_0021", "撒娇青年 · 平稳"),
    ("m_y_0027", "粘人男友 · 平稳"),
    ("m_y_0027_a", "粘人男友 · 深情"),
    ("m_y_0028", "温柔霸总 · 平稳"),
    (SENSEAUDIO_DEFAULT_VOICE, "气质学姐 · 开心"),
    ("m_y_0034_e", "可靠青叔 · 主题升华"),
    ("m_y_0036_e", "利落青年 · 细心提问"),
)
SENSEAUDIO_VOICE_IDS = frozenset(value for value, _label in SENSEAUDIO_VOICE_PRESETS)
