import { monitorEventLoopDelay } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { logger } from '#lib/logger';
import { env } from './env';
import { steamCalls } from './steam-quota';

const log = logger('Charge serveur');
const mib = (bytes: number) => Math.round(bytes / 1024 / 1024);
const memory = () => {
  const usage = process.memoryUsage();
  return { heapMiB: mib(usage.heapUsed), rssMiB: mib(usage.rss), externalMiB: mib(usage.external) };
};

/** Le même budget couvre imports, suivi en direct et entretien, avec priorité aux imports. */
export class WorkScheduler {
  private running = 0;
  private waiting: { priority: number; start: () => void }[] = [];
  readonly active = new Set<string>();
  private sequence = 0;

  constructor(private readonly concurrency: number) {}

  get pending() {
    return this.waiting.length;
  }

  async run<T>(
    name: string,
    task: (yieldSlot: () => Promise<void>) => Promise<T>,
    priority = 0,
  ): Promise<T> {
    const acquire = () =>
      new Promise<void>((resolve) => {
        this.waiting.push({ priority, start: resolve });
        this.waiting.sort((a, b) => b.priority - a.priority);
        this.drain();
      });
    await acquire();
    const started = performance.now();
    // Un identifiant interne distingue deux imports du même fournisseur.
    const label = `${name} #${++this.sequence}`;
    this.active.add(label);
    log.info('Début', { task: name, ...memory(), waiting: this.pending });
    try {
      return await task(async () => {
        if (!this.pending) return;
        this.active.delete(label);
        this.running--;
        await acquire();
        this.active.add(label);
      });
    } finally {
      log.info('Fin', {
        task: name,
        durationMs: Math.round(performance.now() - started),
        ...memory(),
      });
      this.active.delete(label);
      this.running--;
      this.drain();
    }
  }

  private drain() {
    while (this.running < this.concurrency && this.waiting.length) {
      this.running++;
      this.waiting.shift()!.start();
    }
  }
}

let scheduler: WorkScheduler | undefined;
export const backgroundWork = <T>(
  name: string,
  task: (yieldSlot: () => Promise<void>) => Promise<T>,
  priority = 0,
) => (scheduler ??= new WorkScheduler(env().BACKGROUND_CONCURRENCY)).run(name, task, priority);

let timer: NodeJS.Timeout | undefined;
/** Mesures périodiques sans snapshot du tas ni collecte forcée sur le petit CPU du NAS. */
export function startWorkloadMonitor() {
  if (timer) return;
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  timer = setInterval(() => {
    const usage = process.memoryUsage();
    const heapLimit = getHeapStatistics().heap_size_limit;
    const eventLoopP99Ms = Math.round(delay.percentile(99) / 1e6);
    const eventLoopMaxMs = Math.round(delay.max / 1e6);
    const stats = {
      ...memory(),
      heapLimitMiB: mib(heapLimit),
      eventLoopP99Ms,
      eventLoopMaxMs,
      active: [...(scheduler?.active ?? [])],
      waiting: scheduler?.pending ?? 0,
      // Le détail par méthode n'arrive qu'avec l'avertissement et le bilan du jour.
      steamCallsToday: steamCalls().total,
    };
    if (usage.heapUsed / heapLimit > 0.8 || eventLoopMaxMs > 1000) log.warn(stats);
    else log.info(stats);
    delay.reset();
  }, 60_000);
  timer.unref();
}
