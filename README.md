# Doubao Dictation

作者 / Author：**Jiaxin Han**（GitHub：[@Kambrian](https://github.com/Kambrian)）

## 中文说明

**给 OpenClaw 加上豆包语音听写：按住麦克风说话，将语音转成输入框中的文字。**

插件接入火山引擎豆包 ASR 2.0，录音时持续返回识别文本，结束录音后返回最终结果。
适合习惯用中文语音输入的用户；也可识别服务支持的其他语言。

- **边说边识别**：使用流式接口，无需先上传整段录音文件。
- **停止后保留文字**：可在输入框中检查、修改，再发送；也可在听写时直接点发送。
- **保留实时对话**：插件只负责听写，不会替换现有的 Talk 对话服务或聊天模型。
  在支持该手势的 WebUI 中，轻点麦克风启动 Talk，长按启动听写。
- **安装方便**：无需 Python、ffmpeg 或额外运行时依赖，直接使用 OpenClaw 的传输能力。

### 安装与配置

需要 OpenClaw **2026.11.2 或更新版本**，以及开通了
`volc.seedasr.sauc.duration` 资源的火山引擎语音 API Key。
普通豆包聊天模型的 Key 或其他语音资源权限不一定适用。

从 [GitHub Releases](https://github.com/Kambrian/doubao-dictation/releases)
下载插件包后安装：

```sh
openclaw plugins install ./doubao-dictation-1.0.3.tgz --force --accept-capabilities
```

将自己的语音 Key 写入 OpenClaw 状态目录下的 `.env` 文件，默认位置为
`~/.openclaw/.env`。使用自定义状态目录时，请写入对应目录。

```dotenv
DOUBAO_ASR_API_KEY=替换为你自己的语音API密钥
```

选择听写服务并重启 Gateway：

```sh
openclaw config set agents.defaults.voiceModel doubao-dictation/bigmodel
openclaw gateway restart
openclaw gateway call talk.catalog --json
```

返回结果中应显示 `transcription.ready: true`，且 `activeProvider` 为
`doubao-dictation`。此命令会替换原来的默认语音模型；如需恢复，请先记下原值。
显式配置的其他听写服务可能优先于该默认值。

### 使用范围与隐私

本文的听写入口指 **OpenClaw WebUI**。Android 等原生客户端可能仍调用手机系统的
语音识别服务，安装本插件不会自动替换那条路径。插件也不提供唤醒词或语音合成。

音频会发送到火山引擎进行识别，可能产生服务费用，请查看自己的计费设置。
插件本身不保存录音、识别文本或密钥；OpenClaw 的会话历史和诊断记录仍由宿主设置决定。
请勿把真实密钥提交到 GitHub 或打入插件包。

---

## English

Portable Doubao ASR 2.0 streaming dictation provider for OpenClaw. Returns partial
text while recording and a final transcript after Stop. No build step, Python,
ffmpeg, or additional runtime dependencies. The OpenClaw host supplies the
WebSocket transport.

## Requirements

- OpenClaw **2026.11.2 or later** with native realtime transcription provider
  factories and the Gateway relay transcription API. Verified on 2026.11.2;
  compatibility with future host releases is not guaranteed.
- A Volcengine speech API key authorized for resource
  **`volc.seedasr.sauc.duration`**. A chat-model API key or access to another speech
  resource does not establish access to this one.
- Outbound WebSocket access to `openspeech.bytedance.com`.

## Install

Download `doubao-dictation-1.0.3.tgz` from the
[GitHub releases](https://github.com/Kambrian/doubao-dictation/releases), then run:

```sh
openclaw plugins install ./doubao-dictation-1.0.3.tgz --force --accept-capabilities
```

`--force` acknowledges this local package source; `--accept-capabilities`
approves its declared transcription capability. Install only after reviewing
the package. OpenClaw adds the plugin to its enablement and allowlist settings.
If the installer explicitly requires offline state ownership, stop the Gateway
through its existing service manager, rerun the install, and start it again.

Add this entry to the target OpenClaw state directory's `.env` file using a text
editor (or set it through your Gateway service's environment configuration):

```dotenv
DOUBAO_ASR_API_KEY=REPLACE_WITH_YOUR_SPEECH_API_KEY
```

The default state directory is `~/.openclaw`. Custom state directories must use
their own `.env`. The plugin reads the Gateway process environment, not a file
relative to the plugin. Never put a real key in the distributable package.

Select Doubao for transcription:

```sh
openclaw config set agents.defaults.voiceModel doubao-dictation/bigmodel
openclaw gateway restart
openclaw gateway call talk.catalog --json
```

The catalog should show `transcription.ready: true`, active provider
`doubao-dictation`, and `configured: true`. The voice-model setting replaces an
existing default, so retain that value if you want to restore it later. An
explicitly configured transcription provider (for example in voice-call
streaming settings) can take precedence; inspect that setting if the catalog
selects another provider.

## Use

In an OpenClaw WebUI with microphone access and hold-to-dictate enabled:

- Hold the microphone to start dictation.
- Stop keeps recognized text in the composer.
- Send submits the recognized text.
- A short tap retains the host's Talk behavior when a Talk provider is configured.

This plugin registers transcription only. It does not configure conversational
Talk, speech synthesis, or a chat model. Existing Talk settings remain in effect.
Native mobile dictation may use the operating system's speech recognizer;
installing this Gateway plugin does not replace that mobile implementation.
No WebUI asset patches are included.

## Protocol and data

Uses `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel`, resource
`volc.seedasr.sauc.duration`, model `bigmodel`, with punctuation and cumulative
results. Audio arrives from the Gateway as mono G.711 mu-law/8 kHz. It is decoded
and upsampled to PCM16/16 kHz, then sent in gzip-compressed binary frames.
Upsampling does not recover frequencies lost in the original audio.

Stop sends a terminal audio frame and waits up to 14 seconds for the final
response. Stop during connection setup first waits for the connection and queued
audio. Cancellation closes without committing text. No automatic reconnection
is attempted, to avoid losing or replaying an utterance.

Audio is sent to Volcengine; the API key is sent only in the request header.
The plugin itself writes no recordings, transcripts, or credentials to disk.
OpenClaw's own history, diagnostics, and transport tracing follow host settings;
review those settings before enabling detailed tracing. Provider error frames
report the numeric code without copying remote response bodies.

Protocol reference:
https://docs.volcengine.com/docs/doubao-voice/unidirectional-streaming-automatic-speech-recognition-websocket?lang=zh

That reference describes the `bigmodel_nostream` utterance variant. This plugin
uses the streaming `bigmodel` endpoint, tested with the resource above.

## Development and packaging

```sh
npm test
npm pack --ignore-scripts
```

Tests use mocked transport and synthetic protocol frames; no API key or network
access is required. Live synthetic audio was also verified through the provider
and Gateway. The original deployment passed WebUI Stop, Send, and tap-to-Talk
checks, and real microphone dictation was confirmed by its user. This does not
replace testing microphone capture on a different device.

The npm package contains only the explicitly listed source, documentation,
license, and tests. It contains no installation-specific configuration, real
keys, user messages, audio recordings, or host paths.

## Migration from the prototype

This release uses plugin/provider ID `doubao-dictation`. The earlier local
prototype used `doubao-asr`. Disable that prototype and remove its local plugin
load path before enabling this package, then set the voice model to
`doubao-dictation/bigmodel`. Both versions read `DOUBAO_ASR_API_KEY`.

## Maintenance

Source and issue tracker: https://github.com/Kambrian/doubao-dictation

This is an independent community plugin, not an official Volcengine or OpenClaw
package. Releases are tested against OpenClaw 2026.11.2.
