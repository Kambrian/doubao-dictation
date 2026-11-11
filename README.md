# Doubao Dictation

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

Download `doubao-dictation-1.0.0.tgz` from the
[GitHub releases](https://github.com/Kambrian/doubao-dictation/releases), then run:

```sh
openclaw plugins install ./doubao-dictation-1.0.0.tgz --force --accept-capabilities
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
