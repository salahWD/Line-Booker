// Public pages: branch directory and branch page (lines with live waiting info).
import * as branchModel from '../models/branch.model.js';
import * as lineModel from '../models/line.model.js';
import * as ticketModel from '../models/ticket.model.js';
import * as lineService from '../services/line.service.js';
import * as reviewService from '../services/review.service.js';
import * as realtime from '../services/realtime.service.js';
import { notFound } from '../utils/errors.js';
import { t } from '../locales/ar.js';

export async function home(req, res) {
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  const branches = await branchModel.listPublic(q);
  const lines = await lineModel.listByBranchIds(branches.map((b) => b.id), { activeOnly: true });
  const waiting = await ticketModel.waitingCounts(lines.map((l) => l.id));
  const waitingByBranch = {};
  const linesByBranch = {};
  for (const line of lines) {
    waitingByBranch[line.branchId] = (waitingByBranch[line.branchId] ?? 0) + (waiting[line.id] ?? 0);
    (linesByBranch[line.branchId] ??= []).push(line);
  }
  res.render('pages/public/home', { title: t('home.title'), branches, linesByBranch, waitingByBranch, q });
}

async function loadBranch(slug) {
  const found = await branchModel.findPublicBySlug(String(slug));
  if (!found) throw notFound();
  return found;
}

export async function branchPage(req, res) {
  const { branch, businessName } = await loadBranch(req.params.slug);
  const lines = await lineModel.listByBranch(branch.id, { activeOnly: true });
  const [summaries, hours, reviews, ratings] = await Promise.all([
    Promise.all(lines.map((line) => lineService.publicLineSummary(line, branch))),
    branchModel.listHours(branch.id),
    reviewService.listForBranch(branch.id, 10),
    reviewService.ratingByBranch([branch.id]),
  ]);
  const summaryById = Object.fromEntries(summaries.map((s) => [s.id, s]));
  res.render('pages/public/branch', {
    title: `${branch.name} — ${businessName}`,
    branch,
    businessName,
    lines: lines.map((line) => ({ ...line, summary: summaryById[line.id], policyText: lineService.policyText(line) })),
    hours,
    reviews,
    rating: ratings[branch.id],
  });
}

/** JSON for the live counters on the branch page (no personal data). */
export async function branchState(req, res) {
  const { branch } = await loadBranch(req.params.slug);
  const lines = await lineModel.listByBranch(branch.id, { activeOnly: true });
  const summaries = await Promise.all(lines.map((line) => lineService.publicLineSummary(line, branch)));
  res.json({ lines: summaries, updatedAt: new Date().toISOString() });
}

export async function branchEvents(req, res) {
  const { branch } = await loadBranch(req.params.slug);
  realtime.subscribe(req, res, [`branch:${branch.id}`]);
}
