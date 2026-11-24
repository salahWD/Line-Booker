// Public waiting-room display (/display/:token). Shows ticket codes and counters only.
import * as branchModel from '../models/branch.model.js';
import * as lineService from '../services/line.service.js';
import * as realtime from '../services/realtime.service.js';
import { notFound } from '../utils/errors.js';
import { t } from '../locales/ar.js';

async function loadBranch(token) {
  const branch = await branchModel.findByDisplayToken(String(token));
  if (!branch || !branch.isActive) throw notFound();
  return branch;
}

export async function page(req, res) {
  const branch = await loadBranch(req.params.token);
  res.render('pages/display/board', {
    layout: 'layouts/display',
    title: `${t('nav.home')} — ${branch.name}`,
    branch,
    token: req.params.token,
    lineFilter: req.query.line ? Number(req.query.line) : null,
  });
}

export async function state(req, res) {
  const branch = await loadBranch(req.params.token);
  res.json(await lineService.displayView({ branch, lineFilterId: req.query.line }));
}

export async function events(req, res) {
  const branch = await loadBranch(req.params.token);
  realtime.subscribe(req, res, [`branch:${branch.id}`]);
}
