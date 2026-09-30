# ElevenLabs Agent

Use a hosted [ElevenLabs Agent](https://elevenlabs.io/agents) as the voice
frontend. ElevenLabs runs speech-to-text (Scribe), the conversational LLM and
text-to-speech on its own infrastructure; the Gateway connects to the agent
over a single WebSocket, streams microphone audio, and executes the agent's
client tool calls — including `spawn_thinking`, which is how the agent starts
background work on your backend Agent (OpenCode, Qwen Code, …).

Everything else — task orchestration, permissions, memory, result
announcements — stays with the Gateway and works exactly as with any other
voice frontend.

## 1. Prepare the ElevenLabs agent

The agent needs the runtime's frontend tools registered as **client tools**,
the frontend instructions in its prompt, and `pcm_16000` audio formats. The
setup script does all of this through the ElevenLabs API:

```bash
# Create a new agent:
ELEVENLABS_API_KEY=your-key node scripts/elevenlabs-agent-setup.mjs --create "My Assistant"

# Or update an existing one:
ELEVENLABS_API_KEY=your-key ELEVENLABS_AGENT_ID=agent_... node scripts/elevenlabs-agent-setup.mjs
```

Useful flags: `--language ar` (default), `--llm gemini-2.5-flash`,
`--voice <voice_id>`, `--tts-model eleven_flash_v2_5`,
`--first-message "..."`, `--prompt-mode merge|replace|keep`.

Re-run the script after upgrading this repository so the agent's tools and
instructions stay in sync. For tool calling, ElevenLabs recommends capable
LLMs such as Gemini 2.5 Flash, GPT-5.x or Claude Sonnet; avoid Gemini 2.0
Flash.

## 2. Configure the Gateway

Add to `config.env` (default `~/.config/qwaudio/config.env`), or use the
desktop Settings form:

```dotenv
QWEN_AUDIO_REALTIME_PROVIDER=elevenlabs
ELEVENLABS_AGENT_ID=agent_...
# Required for private agents (auth enabled); optional for public agents:
ELEVENLABS_API_KEY=your-key
# Optional overrides:
ELEVENLABS_VOICE_ID=...            # per-session voice override
ELEVENLABS_AGENT_LANGUAGE=ar       # per-session language override
ELEVENLABS_REALTIME_URL=wss://api.elevenlabs.io/v1/convai/conversation
```

Start the Gateway and connect any client (TUI, WebUI, desktop).

## Arabic conversations

Set the agent language to Arabic (`--language ar` in the setup script or the
agent dashboard). Scribe STT and the Flash/Multilingual TTS models support
Arabic natively; pick an Arabic-capable voice in the agent's TTS settings.

## Notes and limitations

- The agent's prompt, tools, LLM, voice and turn-taking are owned by
  ElevenLabs and configured agent-side (via the setup script or dashboard),
  not per session.
- Frontend tools that this repository injects dynamically (MCP/OpenAPI tools)
  are not registered on the hosted agent and are unavailable with this
  frontend.
- Video/image input is not supported by the ElevenLabs conversation socket.
- User-side interruption (barge-in) is detected by ElevenLabs VAD; the
  client cannot cancel a hosted agent's turn programmatically.
- Both audio formats must stay `pcm_16000`; the setup script enforces this
  and the Gateway fails fast with a clear error otherwise.
