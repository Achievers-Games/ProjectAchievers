import { describe, expect, it, vi } from 'vitest';
import { WorkScheduler } from './workload';

describe('budget des traitements de fond', () => {
  it('partage le budget et laisse un import dépasser la maintenance en attente', async () => {
    const queue = new WorkScheduler(1);
    const order: string[] = [];
    let finish!: () => void;
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = queue.run('premier', async () => {
      order.push('premier');
      await blocked;
    });
    const maintenance = queue.run(
      'entretien',
      async () => {
        order.push('entretien');
      },
      -1,
    );
    const sync = queue.run(
      'import',
      async () => {
        order.push('import');
      },
      1,
    );
    await Promise.resolve();
    expect(queue.active.size).toBe(1);
    expect(queue.pending).toBe(2);
    finish();
    await Promise.all([first, maintenance, sync]);
    expect(order).toEqual(['premier', 'import', 'entretien']);
    expect(queue.active.size).toBe(0);
  });

  it('libère le budget même après une erreur', async () => {
    const queue = new WorkScheduler(1);
    const next = vi.fn(async () => 42);
    const failure = queue.run('erreur', async () => {
      throw new Error('échec');
    });
    const following = queue.run('suivant', next);
    await expect(failure).rejects.toThrow('échec');
    await expect(following).resolves.toBe(42);
    expect(next).toHaveBeenCalledOnce();
    expect(queue.active.size).toBe(0);
  });
});
