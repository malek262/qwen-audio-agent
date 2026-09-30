# ElevenLabs Agent

使用托管的 [ElevenLabs Agent](https://elevenlabs.io/agents) 作为语音前台。ElevenLabs
在其自有基础设施上运行语音识别（Scribe）、对话 LLM 和语音合成（TTS）；Gateway 通过
单个 WebSocket 连接到该 Agent，推送麦克风音频，并执行 Agent 发起的客户端工具调用——
包括 `spawn_thinking`，Agent 正是通过它在后台 Agent（OpenCode、Qwen Code 等）上
启动后台任务。

两个工具行为决定了对话体验：

- `enter_sleep`（客户端工具，由桌面端执行）：当用户让助手退下（"go to sleep"、
  "مع السلامة"）时，Agent 调用它，桌面端随即收起面板、停止推送麦克风音频，
  只保留本地唤醒词监听。说出唤醒词即可恢复同一段对话——无需手动重连，
  也不会结束通话。
- `skip_turn`（ElevenLabs 系统工具，通过 tools 数组安装）：当转录为空或只有
  噪音时，Agent 调用它保持沉默，而不是对着 "..." 强行作答。

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

常用参数：`--language ar`（默认）、`--llm gemini-3.8-flash`、
`--voice <voice_id>`、`--tts-model eleven_v4_turbo`、
`--reasoning low|medium|high`（默认 `low`，压低语音延迟）、
`--first-message "..."`、`--prompt-mode merge|replace|keep`。

升级本仓库后请重新运行该脚本，使 Agent 上的工具与指令保持同步。工具调用建议使用
工具调用请选择当前一代的模型：Gemini 3.8 Flash（默认，实测 3/3 成功调用）、
GPT-5.x 或 Claude Sonnet；旧代 Gemini Flash 经常只口头表达意图而不真正调用工具。

## 2. 配置 Gateway

写入 `config.env`（默认 `~/.config/qwaudio/config.env`）。桌面端也请通过
`config.env` 设置 Agent ID——桌面端的模型行是固定列表，无法输入自由文本的
Agent ID：

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
Scribe 语音识别与 v4/Turbo/Multilingual 语音合成模型均原生支持阿拉伯语；请在 Agent 的
TTS 设置中选择支持阿拉伯语的音色。

## 自定义 Agent

Agent 的行为托管在 ElevenLabs 侧，不随会话下发。修改方式：

1. **人格与偏好规则**：编辑
   `~/.config/qwaudio/elevenlabs-agent-prompt.md`（可用任意语言；主 prompt
   默认以阿拉伯语/约旦方言回复），然后重新运行 `npm run elevenlabs:setup`。
2. **LLM / TTS 模型 / 音色**：带参数重跑脚本，例如
   `node scripts/elevenlabs-agent-setup.mjs --llm gemini-3.8-flash --tts-model eleven_v4_turbo --voice <voice_id>`。
3. 安装脚本每次都会重写其管理的 prompt 区段，因此仓库升级后重跑即可刷新
   工具指令。

## 说明与限制

- Agent 的 prompt、工具、LLM、音色与轮次检测由 ElevenLabs 托管，在 Agent 侧配置
  （通过安装脚本或控制台），而非按会话下发。
- 本仓库动态注入的前台工具（MCP/OpenAPI 工具）不会注册到托管 Agent，此前台下不可用。
- ElevenLabs 会话 socket 不支持视频/图片输入。
- 用户打断（barge-in）由 ElevenLabs VAD 在服务端检测；客户端无法以编程方式取消
  托管 Agent 的当前回合。
- 双向音频格式必须保持 `pcm_16000`；安装脚本会强制设置，否则 Gateway 会以明确的
  错误快速失败。
