import { buildProvider } from './provider.js';

export default (context) => ({
  realtimeTranscriptionProviders: [buildProvider(context)],
});
