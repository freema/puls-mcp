import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../src/tools/writes.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 3, async (n) => {
      // Vyšší čísla doběhnou dřív → výsledek se MUSÍ řadit podle vstupu.
      await tick((6 - n) * 2);
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('never runs more than `concurrency` tasks at once', async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await tick(1);
        active -= 1;
      }
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('processes every item when nothing throws', async () => {
    const seen: number[] = [];
    await mapWithConcurrency(
      Array.from({ length: 13 }, (_, i) => i),
      5,
      async (n) => {
        seen.push(n);
      }
    );
    expect(seen.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 13 }, (_, i) => i)
    );
  });

  it('aborts and rethrows when fn throws (rate-limit abort semantics)', async () => {
    let started = 0;
    const boom = new Error('rate limit');
    await expect(
      mapWithConcurrency(
        Array.from({ length: 50 }, (_, i) => i),
        4,
        async (n) => {
          started += 1;
          await tick(1);
          if (n === 2) throw boom;
          return n;
        }
      )
    ).rejects.toBe(boom);
    // Po vyhození se přestanou brát NOVÉ položky → ne všech 50 se rozjede.
    expect(started).toBeLessThan(50);
  });
});
