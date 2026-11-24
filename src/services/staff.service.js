// Owner management of operator accounts and their branch assignments.
// Operators are for access and administrative actions only — customers never pick them.
import { transaction, isUniqueViolation } from '../config/db.js';
import * as userModel from '../models/user.model.js';
import * as branchModel from '../models/branch.model.js';
import * as access from './access.service.js';
import * as audit from './audit.service.js';
import { hashPassword } from './auth.service.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';

const duplicate = () => conflict('البريد الإلكتروني أو رقم الهاتف مستخدم لحساب آخر.');

/** Only branches of the owner's own business may be assigned. */
async function validBranchIds(user, branchIds) {
  const own = new Set((await branchModel.listByBusiness(user.businessId)).map((b) => b.id));
  const ids = [...new Set(branchIds.map(Number))];
  if (ids.some((id) => !own.has(id))) throw badRequest('فرع غير صالح.');
  return ids;
}

async function operatorForOwner(user, operatorId) {
  const operator = await userModel.findById(Number(operatorId));
  if (!operator || operator.role !== 'branch_operator') throw notFound();
  access.assertOwnerOf(user, operator.businessId);
  return operator;
}

export async function listOperators(user) {
  const operators = await userModel.listOperators(user.businessId);
  return Promise.all(operators.map(async (op) => ({ ...op, branchIds: await userModel.operatorBranchIds(op.id) })));
}

export async function createOperator(user, { name, email, phone, password, branchIds }, ip) {
  access.assertOwnerOf(user, user.businessId);
  const ids = await validBranchIds(user, branchIds);
  const passwordHash = await hashPassword(password);
  try {
    return await transaction(async (tx) => {
      const operator = await userModel.create(
        { role: 'branch_operator', name, email: email ? email.toLowerCase() : null, phone: phone || null, passwordHash, businessId: user.businessId },
        tx,
      );
      await userModel.setOperatorBranches(operator.id, ids, tx);
      await audit.log(tx, { actor: user, action: 'operator.create', entityType: 'user', entityId: operator.id, after: { name, email, phone, branchIds: ids }, ip });
      return operator;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicate();
    throw err;
  }
}

export async function updateOperator(user, operatorId, { name, email, phone, branchIds, isActive, password }, ip) {
  const operator = await operatorForOwner(user, operatorId);
  const ids = await validBranchIds(user, branchIds);
  const before = { name: operator.name, email: operator.email, phone: operator.phone, isActive: operator.isActive, branchIds: await userModel.operatorBranchIds(operator.id) };
  const data = { name, email: email ? email.toLowerCase() : null, phone: phone || null, isActive };
  if (password) data.passwordHash = await hashPassword(password);
  try {
    return await transaction(async (tx) => {
      const updated = await userModel.update(operator.id, data, tx);
      await userModel.setOperatorBranches(operator.id, ids, tx);
      await audit.log(tx, {
        actor: user,
        action: 'operator.update',
        entityType: 'user',
        entityId: operator.id,
        before,
        after: { name, email, phone, isActive, branchIds: ids, passwordChanged: Boolean(password) },
        ip,
      });
      return updated;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicate();
    throw err;
  }
}

export async function getOperator(user, operatorId) {
  const operator = await operatorForOwner(user, operatorId);
  return { ...operator, branchIds: await userModel.operatorBranchIds(operator.id) };
}
