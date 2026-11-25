import { v4 as uuid } from 'uuid';
import type { DvrDatabase } from '../db/database.js';
import type { Channel, TunerDevice, TunerLease } from '../types/index.js';

export class TunerPool {
  private leases = new Map<string, TunerLease>();
  private onChange?: () => void;

  constructor(private db: DvrDatabase, onChange?: () => void) {
    this.onChange = onChange;
  }

  getActiveLeases(): TunerLease[] {
    return Array.from(this.leases.values());
  }

  getTunerUtilization(): Array<{
    tuner: TunerDevice;
    activeLeases: TunerLease[];
    freeSlots: number;
  }> {
    const tuners = this.db.listTuners();
    return tuners.map((tuner) => {
      const activeLeases = this.getActiveLeases().filter((l) => l.tunerId === tuner.id);
      return {
        tuner,
        activeLeases,
        freeSlots: Math.max(0, tuner.tunerCount - activeLeases.length),
      };
    });
  }

  /**
   * Acquires a tuner lease for a channel.
   * Whole-house optimization: if another viewer or recording is ALREADY tuned to the exact same
   * channel on the same tuner, reuse that tuner slot without consuming an extra hardware tuner!
   */
  acquire(channel: Channel, purpose: 'live' | 'recording', ownerId: string): TunerLease {
    const tuner = this.db.getTuner(channel.tunerId);
    if (!tuner || !tuner.enabled) {
      throw new Error(`Tuner ${channel.tunerId} is unavailable or disabled`);
    }

    // Check if an existing lease already tunes this exact channel on this tuner
    const shared = this.getActiveLeases().find(
      (l) => l.tunerId === tuner.id && l.channelId === channel.id,
    );
    if (shared && purpose === 'live') {
      shared.clientCount += 1;
      this.onChange?.();
      return shared;
    }

    const activeForTuner = this.getActiveLeases().filter((l) => l.tunerId === tuner.id);
    if (activeForTuner.length >= tuner.tunerCount) {
      // If a recording needs a tuner and a live session holds a slot, notify caller
      throw new Error(
        `All ${tuner.tunerCount} tuner slots on "${tuner.name}" are currently in use`,
      );
    }

    const usedSlots = new Set(activeForTuner.map((l) => l.tunerSlot));
    let slot = 0;
    while (usedSlots.has(slot)) slot++;

    const lease: TunerLease = {
      id: uuid(),
      tunerId: tuner.id,
      tunerSlot: slot,
      channelNumber: channel.guideNumber,
      channelId: channel.id,
      purpose,
      ownerId,
      clientCount: 1,
      startedAt: new Date().toISOString(),
    };
    this.leases.set(lease.id, lease);
    this.onChange?.();
    return lease;
  }

  release(leaseId: string): void {
    const lease = this.leases.get(leaseId);
    if (!lease) return;
    if (lease.clientCount > 1) {
      lease.clientCount -= 1;
    } else {
      this.leases.delete(leaseId);
    }
    this.onChange?.();
  }

  releaseByOwner(ownerId: string): void {
    let changed = false;
    for (const [id, lease] of this.leases.entries()) {
      if (lease.ownerId === ownerId) {
        this.leases.delete(id);
        changed = true;
      }
    }
    if (changed) this.onChange?.();
  }

  getTotalEnabledTunerSlots(): number {
    return this.db
      .listTuners()
      .filter((t) => t.enabled)
      .reduce((acc, t) => acc + t.tunerCount, 0);
  }
}
