/**
 * Hela's voice, for the call mode of the chat panel (src/components/Assistant.jsx).
 *   speakable(answer)   the answer as it should be said aloud: no source line, no codes, units in words
 *   speak(text)         the audio of that text from ElevenLabs → { status, type, body } (503 when no key is set)
 *   voiceStatus()       { elevenlabs: true | false }: without a key the browser's own voice is used instead
 * Settings in .env: ELEVENLABS_API_KEY (needed), ELEVENLABS_VOICE (a voice id), ELEVENLABS_MODEL (default eleven_flash_v2_5,
 * the low-delay model). The key stays on the server: the browser asks this server for the audio, never ElevenLabs itself.
 * Hearing the user is done in the browser (its built-in speech recognition), so no audio of the user passes through here.
 */
const KEY = () => process.env.ELEVENLABS_API_KEY;
const VOICE = () => process.env.ELEVENLABS_VOICE || "21m00Tcm4TlvDq8ikWAM"; // one of ElevenLabs' stock voices; any voice id from the account works
const MODEL = () => process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5";
const MAX_SPOKEN = 700; // characters: about forty seconds of speech, and the cost of one answer

export const voiceStatus = () => ({ elevenlabs: !!KEY() });

/* What is written for the eye and has to be said differently, or not at all. */
const SAID = [
  [/\(I read the subject of your question from the Urdu and answer in English\.\)\s*/g, ""],
  [/Not loaded in the portal: /g, "The portal does not hold "], [/What the data does show:\s*/g, "What it does show: "],
  [/\s*\(MAF = million acre-feet\.\)/g, ""], [/\bMAF\b/g, "million acre-feet"],
  [/\((projected|measured)?,? ?ssp126\)/gi, "(projected, low emissions)"], [/\((projected)?,? ?ssp245\)/gi, "(projected)"], [/\((projected)?,? ?ssp585\)/gi, "(projected, high emissions)"],
  [/\bssp126\b/gi, "low emissions"], [/\bssp245\b/gi, "medium emissions"], [/\bssp585\b/gi, "high emissions"],
  [/\((IND-\d+), /g, "("], [/\s*\((CMEMS-LSCE|GMW v3 by zone)\)/g, ""], [/\bGMW v3\b/g, "Global Mangrove Watch"], [/\(whole EEZ\)/g, ""], [/\bEEZ\b/g, "economic zone"],
  [/\s*\(\d psu\)/g, ""], [/km²/g, "square kilometres"], [/(\d) km\b/g, "$1 kilometres"], [/(\d) m\b/g, "$1 metres"], [/per m²/g, "per square metre"], [/µg\/g/g, "micrograms per gram"], [/µmol\/kg/g, "micromoles per kilogram"], [/mg\/L/g, "milligrams per litre"], [/°C/g, "degrees Celsius"],
  [/\bppm\b/g, "parts per million"], [/\bpsu\b/g, "salinity units"], [/(\d) ?%/g, "$1 percent"], [/(\d{4})[–-](\d{4})/g, "$1 to $2"], [/\s*→\s*/g, " to "], [/ \/ /g, " and "], [/[“”"]/g, ""], [/\s*•\s*/g, ", "],
];

/** The answer as speech: the sentences that answer, in order, without what only makes sense on a screen. */
export function speakable(answer) {
  const blocks = String(answer ?? "").split(/\n{2,}/).filter((b) => !/^Source:/.test(b.trim()));
  let text = blocks.map((b) => b.split("\n").map((l) => l.replace(/^- /, "").trim()).filter(Boolean).map((l) => (/[.!?:]$/.test(l) ? l : `${l}.`)).join(" ")).join(" ");
  for (const [re, to] of SAID) text = text.replace(re, to);
  text = text.replace(/\s+/g, " ").replace(/ ([,.;:])/g, "$1").trim();
  if (text.length <= MAX_SPOKEN) return text;
  const cut = text.slice(0, MAX_SPOKEN), stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return `${cut.slice(0, stop > 200 ? stop + 1 : MAX_SPOKEN).trim()} The rest is on the screen.`;
}

export async function speak(text) {
  const said = String(text ?? "").trim().slice(0, MAX_SPOKEN + 60);
  if (!said) return { status: 400, error: "Nothing to say." };
  if (!KEY()) return { status: 503, error: "No ElevenLabs key is set (ELEVENLABS_API_KEY in .env); the browser's own voice is used." };
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(VOICE())}?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": KEY(), "Content-Type": "application/json", Accept: "audio/mpeg" }, signal: AbortSignal.timeout(25000),
      body: JSON.stringify({ text: said, model_id: MODEL() }),
    });
    if (!r.ok) {
      const why = (await r.text()).slice(0, 200);
      console.warn(`voice: ElevenLabs ${r.status} ${why}`);
      return { status: 502, error: r.status === 401 ? "ElevenLabs rejected the key (check ELEVENLABS_API_KEY)." : r.status === 429 ? "ElevenLabs quota or rate limit reached." : `ElevenLabs returned ${r.status}.` };
    }
    return { status: 200, type: "audio/mpeg", body: Buffer.from(await r.arrayBuffer()) };
  } catch (e) {
    console.warn(`voice: ${e.message}`);
    return { status: 502, error: "Could not reach ElevenLabs." };
  }
}
