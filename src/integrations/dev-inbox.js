// DEVELOPMENT ONLY — in-memory inbox filled by the mock SMS and push providers,
// shown on /dev/notifications so you can read OTP codes and alerts without a phone.
const MAX = 100;
const inbox = [];

export function addToDevInbox(entry) {
  inbox.unshift({ ...entry, at: new Date() });
  if (inbox.length > MAX) inbox.pop();
}

export function readDevInbox() {
  return inbox;
}
