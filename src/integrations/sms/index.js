// SMS provider factory. Every provider implements:
//   send({ to, body }) → Promise<{ providerMessageId, delivered }>
// To add a provider: create xxx.provider.js with that method and register it below.
import { env } from '../../config/env.js';
import { mockSmsProvider } from './mock.provider.js';
import { twilioSmsProvider } from './twilio.provider.js';

const providers = { mock: mockSmsProvider, twilio: twilioSmsProvider };

export function getSmsProvider() {
  return providers[env.SMS_PROVIDER] ?? mockSmsProvider;
}
