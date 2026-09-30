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

Useful flags: `--language ar` (default), `--llm gemini-3.8-flash`,
`--voice <voice_id>`, `--tts-model eleven_v4_turbo`,
`--reasoning low|medium|high` (default `low` for voice latency),
`--first-message "..."`, `--prompt-mode merge|replace|keep`.

Re-run the script after upgrading this repository so the agent's tools and
instructions stay in sync. For reliable client-tool calling, pick a current
tool-use LLM — Gemini 3.8 Flash (default, measured 3/3 tool calls), GPT-5.x
or Claude Sonnet; older Gemini Flash generations frequently answer with
intent instead of calling the tool.

## 2. Configure the Gateway

Add to `config.env` (default `~/.config/qwaudio/config.env`). On Desktop, set
the Agent ID through `config.env` as well — the desktop model row is a fixed
list and cannot accept a free-form agent id:

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
agent dashboard). Scribe STT and the v4/Turbo/Multilingual TTS models support
Arabic natively; pick an Arabic-capable voice in the agent's TTS settings.

## Customizing the agent

The agent's behavior lives on ElevenLabs, not in a session. To change it:

1. **Persona and house rules**: edit
   `~/.config/qwaudio/elevenlabs-agent-prompt.md` (any language works; the
   master prompt keeps Arabic/Jordanian as the default reply language), then
   re-run `npm run elevenlabs:setup`.
2. **LLM / TTS model / voice**: re-run with flags, e.g.
   `node scripts/elevenlabs-agent-setup.mjs --llm gemini-3.8-flash --tts-model eleven_v4_turbo --voice <voice_id>`.
3. The setup script always rewrites the managed prompt sections, so re-running
   after a repository upgrade refreshes the tool instructions.

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
