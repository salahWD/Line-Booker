// Platform-wide settings: the platform's Whish Money link (all appointment fees are paid
// there) and the default hold time. Only the platform admin can change them.
import { transaction } from '../config/db.js';
import * as misc from '../models/misc.model.js';
import * as audit from './audit.service.js';
import { assertPlatformAdmin } from './access.service.js';

export async function getSettings() {
  return misc.getSettings();
}

export async function updateSettings(admin, data, ip) {
  assertPlatformAdmin(admin);
  return transaction(async (tx) => {
    const before = await misc.getSettings(tx);
    const saved = await misc.saveSettings({ ...data, updatedById: admin.id }, tx);
    const changes = audit.diff(before, data);
    await audit.log(tx, { actor: admin, action: 'platform.settings.update', entityType: 'platform_settings', entityId: 1, ...changes, ip });
    return saved;
  });
}

/** Minutes a slot is held while the customer pays (branch override → platform default). */
export async function holdMinutesFor(branch) {
  if (branch.holdMinutes) return branch.holdMinutes;
  const settings = await misc.getSettings();
  return settings.defaultHoldMinutes || 30;
}
