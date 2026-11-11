import { buildProvider } from './provider.js';

export default {
  id: 'doubao-dictation',
  name: 'Doubao Dictation',
  register(api) {
    api.registerRealtimeTranscriptionProvider(buildProvider);
  },
};
