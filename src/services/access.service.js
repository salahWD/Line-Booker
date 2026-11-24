// Business & branch isolation — the single place that decides which branches a staff
// member may touch. Everything that loads data for staff goes through these helpers.
//
//   platform_admin   → every branch
//   business_owner   → every branch of their own business
//   branch_operator  → only the branches assigned to them
//
// A branch outside the user's scope is reported as "not found" (404), never 403,
// so IDs of other businesses cannot be discovered by guessing.
import * as userModel from '../models/user.model.js';
import * as branchModel from '../models/branch.model.js';
import * as lineModel from '../models/line.model.js';
import { notFound, forbidden } from '../utils/errors.js';

/** Branch IDs the user can manage, or null meaning "all" (platform admin). */
export async function accessibleBranchIds(user) {
  if (user.role === 'platform_admin') return null;
  if (user.role === 'business_owner') {
    const branches = await branchModel.listByBusiness(user.businessId);
    return branches.map((b) => b.id);
  }
  if (user.role === 'branch_operator') return userModel.operatorBranchIds(user.id);
  return [];
}

export function canAccessBranchSync(user, branch, operatorBranchIds = []) {
  if (!branch) return false;
  if (user.role === 'platform_admin') return true;
  if (user.role === 'business_owner') return branch.businessId === user.businessId;
  if (user.role === 'branch_operator') return branch.businessId === user.businessId && operatorBranchIds.includes(branch.id);
  return false;
}

export async function getBranchForStaff(user, branchId) {
  const branch = await branchModel.findById(Number(branchId));
  const opIds = user.role === 'branch_operator' ? await userModel.operatorBranchIds(user.id) : [];
  if (!canAccessBranchSync(user, branch, opIds)) throw notFound();
  return branch;
}

/** Returns { line, branch } if the user may operate this line. */
export async function getLineForStaff(user, lineId) {
  const found = await lineModel.findWithBranch(Number(lineId));
  if (!found) throw notFound();
  const opIds = user.role === 'branch_operator' ? await userModel.operatorBranchIds(user.id) : [];
  if (!canAccessBranchSync(user, found.branch, opIds)) throw notFound();
  return found;
}

/** Throws unless the record (anything with branchId + businessId) is within the user's scope. */
export async function assertRecordAccess(user, record) {
  if (!record) throw notFound();
  const opIds = user.role === 'branch_operator' ? await userModel.operatorBranchIds(user.id) : [];
  if (!canAccessBranchSync(user, { id: record.branchId, businessId: record.businessId }, opIds)) throw notFound();
}

/** Owner-only actions (branch settings, operators, reports). Admins are allowed too. */
export function assertOwnerOf(user, businessId) {
  if (user.role === 'platform_admin') return;
  if (user.role !== 'business_owner' || user.businessId !== businessId) throw notFound();
}

export function assertPlatformAdmin(user) {
  if (user?.role !== 'platform_admin') throw forbidden();
}
