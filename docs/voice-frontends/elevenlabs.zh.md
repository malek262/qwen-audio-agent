# ElevenLabs Agent

使用托管的 [ElevenLabs Agent](https://elevenlabs.io/agents) 作为语音前台。ElevenLabs
在其自有基础设施上运行语音识别（Scribe）、对话 LLM 和语音合成（TTS）；Gateway 通过
单个 WebSocket 连接到该 Agent，推送麦克风音频，并执行 Agent 发起的客户端工具调用——
包括 `spawn_thinking`，Agent 正是通过它在后台 Agent（OpenCode、Qwen Code 等）上
启动后台任务。

其余一切——任务编排、权限、记忆、结果播报——仍由 Gateway 负责，行为与其他语音前台
完全一致。

## 1. 准备 ElevenLabs Agent

Agent 需要将本运行时的前台工具注册为**客户端工具**、在 prompt 中写入前台指令，并将
音频格式固定为 `pcm_16000`。安装脚本通过 ElevenLabs API 完成以上全部工作：

```bash
# 创建新 Agent：
ELEVENLABS_API_KEY=你的key node scripts/elevenlabs-agent-setup.mjs --create "My Assistant"

# 或更新已有 Agent：
ELEVENLABS_API_KEY=你的key ELEVENLABS_AGENT_ID=agent_... node scripts/elevenlabs-agent-setup.mjs
```

常用参数：`--language ar`（默认）、`--llm gemini-2.5-flash`、
`--voice <voice_id>`、`--tts-model eleven_flash_v2_5`、
`--first-message "..."`、`--prompt-mode merge|replace|keep`。

升级本仓库后请重新运行该脚本，使 Agent 上的工具与指令保持同步。工具调用建议使用
能力较强的 LLM（如 Gemini 2.5 Flash、GPT-5.x、Claude Sonnet）；请避免使用
Gemini 2.0 Flash。

## 2. 配置 Gateway

写入 `config.env`（默认 `~/.config/qwaudio/config.env`），或使用桌面端设置界面：

```dotenv
QWEN_AUDIO_REALTIME_PROVIDER=elevenlabs
ELEVENLABS_AGENT_ID=agent_...
# 私有 Agent（启用鉴权）必填；公开 Agent 可留空：
ELEVENLABS_API_KEY=你的key
# 可选覆盖：
ELEVENLABS_VOICE_ID=...            # 按会话覆盖音色
ELEVENLABS_AGENT_LANGUAGE=ar       # 按会话覆盖语言
ELEVENLABS_REALTIME_URL=wss://api.elevenlabs.io/v1/convai/conversation
```

启动 Gateway 后连接任一客户端（TUI、WebUI、桌面端）。

## 阿拉伯语对话

将 Agent 语言设置为阿拉伯语（安装脚本的 `--language ar`，或在 Agent 控制台设置）。
Scribe 语音识别与 Flash/Multilingual 语音合成模型均原生支持阿拉伯语；请在 Agent 的
TTS 设置中选择支持阿拉伯语的音色。

## 说明与限制

- Agent 的 prompt、工具、LLM、音色与轮次检测由 ElevenLabs 托管，在 Agent 侧配置
  （通过安装脚本或控制台），而非按会话下发。
- 本仓库动态注入的前台工具（MCP/OpenAPI 工具）不会注册到托管 Agent，此前台下不可用。
- ElevenLabs 会话 socket 不支持视频/图片输入。
- 用户打断（barge-in）由 ElevenLabs VAD 在服务端检测；客户端无法以编程方式取消
  托管 Agent 的当前回合。
- 双向音频格式必须保持 `pcm_16000`；安装脚本会强制设置，否则 Gateway 会以明确的
  错误快速失败。
