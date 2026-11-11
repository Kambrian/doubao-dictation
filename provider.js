import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';

const ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel';
const RESOURCE = 'volc.seedasr.sauc.duration';
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const FINAL_TIMEOUT_MS = 14000;

export function frame(type, payload) {
  const body = gzipSync(payload);
  const header = Buffer.alloc(8);
  header.set([0x11, type, type === 0x10 ? 0x11 : 0x01, 0]);
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

export function parseFrame(raw) {
  const bytes = Buffer.from(raw);
  if (bytes.length < 8 || bytes[0] >> 4 !== 1) {
    throw new Error('Invalid Doubao response header');
  }
  const type = bytes[1] >> 4;
  const flags = bytes[1] & 15;
  let offset = (bytes[0] & 15) * 4;
  if (offset < 4 || offset + 4 > bytes.length) {
    throw new Error('Truncated Doubao response header');
  }
  if (type === 15) {
    // Report the numeric code only; remote bodies may contain sensitive data.
    throw new Error(`Doubao ASR error ${bytes.readUInt32BE(offset)}`);
  }
  if (type !== 9) throw new Error('Unexpected Doubao response type');
  if (flags & 1) offset += 4;
  if (offset + 4 > bytes.length) throw new Error('Truncated Doubao response header');
  const size = bytes.readUInt32BE(offset);
  offset += 4;
  if (size > MAX_RESPONSE_BYTES || offset + size > bytes.length) {
    throw new Error('Invalid Doubao response size');
  }
  let body = bytes.subarray(offset, offset + size);
  if ((bytes[2] & 15) === 1) {
    body = gunzipSync(body, { maxOutputLength: MAX_RESPONSE_BYTES });
  }
  return { body: JSON.parse(body.toString()), final: Boolean(flags & 2) };
}

// Gateway relay supplies G.711 mu-law at 8 kHz. Decode and duplicate each sample
// to produce the PCM16/16 kHz input required by the ASR endpoint.
export function decodeAudio(audio) {
  const output = Buffer.alloc(audio.length * 4);
  for (let i = 0; i < audio.length; i++) {
    const u = (~audio[i]) & 255;
    let sample = (((u & 15) << 3) + 132) << ((u >> 4) & 7);
    sample = u & 128 ? 132 - sample : sample - 132;
    output.writeInt16LE(sample, i * 4);
    output.writeInt16LE(sample, i * 4 + 2);
  }
  return output;
}

export function buildProvider({ createRealtimeTranscriptionWebSocketSession }) {
  const isConfigured = () => Boolean(process.env.DOUBAO_ASR_API_KEY?.trim());
  return {
    id: 'doubao-dictation',
    label: 'Doubao Streaming Dictation',
    defaultModel: 'bigmodel',
    autoSelectOrder: 10,
    resolveConfig: () => ({}),
    isConfigured,
    isConfiguredAsync: async () => isConfigured(),
    createSession(request) {
      const key = process.env.DOUBAO_ASR_API_KEY?.trim();
      if (!key) throw new Error('DOUBAO_ASR_API_KEY is missing');
      let connection;
      let transport;
      let finished = false;
      let cancelled = false;
      let finishing = false;
      let latest = '';
      let timer;
      let resolveFinal;
      let rejectFinal;
      const final = new Promise((resolve, reject) => {
        resolveFinal = resolve;
        rejectFinal = reject;
      });
      // Errors may arrive before the caller requests finish().
      final.catch(() => {});
      const fail = (error) => {
        if (finished || cancelled) return;
        finished = true;
        clearTimeout(timer);
        rejectFinal(error);
        transport?.closeNow();
        request.onError?.(error);
      };
      const session = createRealtimeTranscriptionWebSocketSession({
        providerId: 'doubao-dictation',
        callbacks: { onError: fail },
        url: ENDPOINT,
        headers: {
          'X-Api-Key': key,
          'X-Api-Resource-Id': RESOURCE,
          'X-Api-Request-Id': randomUUID(),
        },
        readyOnOpen: true,
        maxReconnectAttempts: 0,
        closeTimeoutMs: FINAL_TIMEOUT_MS + 1000,
        parseMessage: parseFrame,
        onOpen(currentTransport) {
          transport = currentTransport;
          transport.sendBinary(frame(0x10, Buffer.from(JSON.stringify({
            user: { uid: 'openclaw-dictation' },
            audio: { format: 'pcm', rate: 16000, bits: 16, channel: 1 },
            request: { model_name: 'bigmodel', enable_punc: true, result_type: 'full' },
          }))));
        },
        sendAudio(audio, currentTransport) {
          const pcm = decodeAudio(audio);
          for (let i = 0; i < pcm.length; i += 6400) {
            currentTransport.sendBinary(frame(0x20, pcm.subarray(i, i + 6400)));
          }
        },
        onMessage(event, currentTransport) {
          if (cancelled || finished) return;
          const result = event.body?.result;
          const text = (Array.isArray(result)
            ? result.map((entry) => typeof entry?.text === 'string' ? entry.text : '').join('')
            : typeof result?.text === 'string' ? result.text : '');
          if (text && text !== latest) {
            if (!latest) request.onSpeechStart?.();
            latest = text;
            request.onPartial?.(text);
          }
          if (event.final) {
            clearTimeout(timer);
            finished = true;
            try {
              if (latest) request.onTranscript?.(latest);
            } finally {
              resolveFinal();
              currentTransport.closeNow();
            }
          }
        },
        onClose(currentTransport) {
          if (!cancelled && !finished) {
            currentTransport.sendBinary(frame(0x22, Buffer.alloc(0)));
          }
        },
      });
      return {
        connect: () => (connection ??= session.connect()),
        sendAudio: (audio) => session.sendAudio(audio),
        isConnected: () => session.isConnected(),
        async finish() {
          if (cancelled) return;
          // An early Stop must not clear queued audio before connection opens.
          await connection;
          if (cancelled) return;
          if (!finished && !finishing) {
            finishing = true;
            timer = setTimeout(() => fail(new Error('Doubao ASR final response timed out')), FINAL_TIMEOUT_MS);
            session.close();
          }
          await final;
        },
        close() {
          cancelled = true;
          clearTimeout(timer);
          resolveFinal();
          session.close();
          transport?.closeNow();
        },
      };
    },
  };
}
