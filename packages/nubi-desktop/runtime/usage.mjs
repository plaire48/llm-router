import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from './store.mjs';
import {newLedger, recordUsage, usageSummary} from '../../../extensions/aipro-chat/usage-ledger.js';

// Reuse the browser's counter rules per call. Separate frames allow chat,
// mail and Wiki calls to overlap without finishing one another's receipts.
export class DesktopUsage {
  constructor(storageRoot) {
    this.store = new Store(path.join(storageRoot, 'usage'));
    this.ledger = this.store.get('usage:ledger') || newLedger();
    this.calls = new Map();
    // A stopped process cannot know usage for an unfinished request. Keep its
    // call in the totals, as unmeasured, rather than keeping a phantom spinner.
    for (const group of [this.ledger.total, ...Object.values(this.ledger.days)]) {
      for (const stats of Object.values(group)) stats.pending = 0;
    }
    this.save();
  }
  save() {
    try {this.store.set('usage:ledger', this.ledger); this.error = null;}
    catch {this.error = 'usage_save_failed';}
  }
  add(frame, previous) {
    for (const [day, providers] of Object.entries(frame.days)) {
      this.ledger.days[day] ||= {};
      for (const [provider, stats] of Object.entries(providers)) {
        for (const target of [this.ledger.total, this.ledger.days[day]]) {
          target[provider] ||= Object.fromEntries(Object.keys(stats).map(key => [key, 0]));
          for (const [key, value] of Object.entries(stats)) {
            target[provider][key] = Math.max(0, target[provider][key] + value - (previous?.days?.[day]?.[provider]?.[key] || 0));
          }
        }
      }
    }
    for (const day of Object.keys(this.ledger.days).sort().slice(0, -31)) delete this.ledger.days[day];
    this.save();
  }
  start({provider}) {
    if (this.closed || !['aipro', 'chatgpt', 'fabrix'].includes(provider)) return null;
    const requestId = randomUUID();
    const frame = recordUsage(newLedger(), {requestId, round:1, provider, phase:'start'});
    this.calls.set(requestId, frame); this.add(frame);
    return requestId;
  }
  finish(requestId, usage) {
    const previous = this.calls.get(requestId);
    if (this.closed || !previous) return;
    this.calls.delete(requestId);
    const provider = previous.active.rounds[1].provider;
    const frame = recordUsage(previous, {requestId, round:1, provider, phase:'finish', usage});
    this.add(frame, previous);
  }
  summary() {return {usage:usageSummary(this.ledger), usageError:this.error};}
  close() {this.closed = true; this.calls.clear(); this.store.close();}
}

export function desktopUsage(host) {
  if (host.disposed) return null;
  try {return host.usageLedger ||= new DesktopUsage(host.storageRoot);}
  catch {return null;}
}
