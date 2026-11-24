// Owner management of branches (settings, fee, hours, holidays) and their lines.
import { transaction, isUniqueViolation } from '../config/db.js';
import * as branchModel from '../models/branch.model.js';
import * as lineModel from '../models/line.model.js';
import * as access from './access.service.js';
import * as audit from './audit.service.js';
import * as realtime from './realtime.service.js';
import { randomToken } from '../utils/codes.js';
import { conflict } from '../utils/errors.js';

const slugTaken = () => conflict('الرابط المختصر مستخدم لفرع آخر. اختر رابطاً مختلفاً.');

async function ownedBranch(user, branchId) {
  const branch = await access.getBranchForStaff(user, branchId);
  access.assertOwnerOf(user, branch.businessId);
  return branch;
}

export async function listForOwner(user) {
  return branchModel.listByBusiness(user.businessId);
}

export async function create(user, data, ip) {
  access.assertOwnerOf(user, user.businessId);
  try {
    return await transaction(async (tx) => {
      const branch = await branchModel.create({ ...data, businessId: user.businessId, displayToken: randomToken() }, tx);
      await audit.log(tx, { actor: user, action: 'branch.create', entityType: 'branch', entityId: branch.id, after: data, ip });
      return branch;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw slugTaken();
    throw err;
  }
}

export async function update(user, branchId, data, ip) {
  const branch = await ownedBranch(user, branchId);
  try {
    return await transaction(async (tx) => {
      const updated = await branchModel.update(branch.id, data, tx);
      const changes = audit.diff(branch, data);
      if (Object.keys(changes.after).length) {
        await audit.log(tx, { actor: user, action: 'branch.update', entityType: 'branch', entityId: branch.id, businessId: branch.businessId, ...changes, ip });
      }
      return updated;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw slugTaken();
    throw err;
  }
}

export async function setHours(user, branchId, rows, ip) {
  const branch = await ownedBranch(user, branchId);
  return transaction(async (tx) => {
    await branchModel.replaceHours(branch.id, rows, tx);
    await audit.log(tx, { actor: user, action: 'branch.hours', entityType: 'branch', entityId: branch.id, businessId: branch.businessId, after: { rows }, ip });
  });
}

export async function addHoliday(user, branchId, date, reason) {
  const branch = await ownedBranch(user, branchId);
  await branchModel.addHoliday(branch.id, date, reason || null);
}

export async function removeHoliday(user, branchId, holidayId) {
  const branch = await ownedBranch(user, branchId);
  await branchModel.removeHoliday(branch.id, Number(holidayId));
}

/** New secret link for the waiting-room display (the old link stops working). */
export async function regenerateDisplayToken(user, branchId, ip) {
  const branch = await ownedBranch(user, branchId);
  return transaction(async (tx) => {
    const updated = await branchModel.update(branch.id, { displayToken: randomToken() }, tx);
    await audit.log(tx, { actor: user, action: 'branch.display_token', entityType: 'branch', entityId: branch.id, businessId: branch.businessId, ip });
    return updated;
  });
}

export async function editData(user, branchId) {
  const branch = await ownedBranch(user, branchId);
  const today = new Date().toISOString().slice(0, 10);
  const [hours, holidays, lines] = await Promise.all([
    branchModel.listHours(branch.id),
    branchModel.listHolidays(branch.id, today),
    lineModel.listByBranch(branch.id),
  ]);
  return { branch, hours, holidays, lines };
}

// ── Lines ──────────────────────────────────────────────────────

export async function createLine(user, branchId, data, ip) {
  const branch = await ownedBranch(user, branchId);
  return transaction(async (tx) => {
    const line = await lineModel.create({ ...data, branchId: branch.id, businessId: branch.businessId, displayToken: randomToken() }, tx);
    await audit.log(tx, { actor: user, action: 'line.create', entityType: 'line', entityId: line.id, businessId: branch.businessId, after: data, ip });
    return line;
  });
}

export async function updateLine(user, lineId, data, ip) {
  const { line } = await access.getLineForStaff(user, lineId);
  access.assertOwnerOf(user, line.businessId);
  return transaction(async (tx) => {
    const updated = await lineModel.update(line.id, data, tx);
    const changes = audit.diff(line, data);
    if (Object.keys(changes.after).length) {
      await audit.log(tx, { actor: user, action: 'line.update', entityType: 'line', entityId: line.id, businessId: line.businessId, ...changes, ip });
    }
    // Policy or pace changes affect everyone's position/estimate → refresh live screens.
    await realtime.notifyLineChange(tx, { lineId: line.id, branchId: line.branchId, type: 'settings' });
    return updated;
  });
}

export async function lineForOwner(user, lineId) {
  const found = await access.getLineForStaff(user, lineId);
  access.assertOwnerOf(user, found.line.businessId);
  return found;
}
