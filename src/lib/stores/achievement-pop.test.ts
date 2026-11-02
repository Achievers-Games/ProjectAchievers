import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { celebrate, dismissAllPops, dismissPop, popQueue } from './achievement-pop';

const pop = (title: string) => ({ title, icon: '', category: 'start', level: 0 });

describe('pile des succès du site', () => {
  it('empile chaque succès, puis passe au suivant à chaque clic', () => {
    celebrate([pop('un'), pop('deux'), pop('trois'), pop('quatre'), pop('cinq')]);
    expect(get(popQueue).map((item) => item.pop.title)).toEqual([
      'un',
      'deux',
      'trois',
      'quatre',
      'cinq',
    ]);

    dismissPop(get(popQueue)[0]!.id);
    expect(get(popQueue)[0]?.pop.title).toBe('deux');

    celebrate([pop('six')]);
    expect(get(popQueue).at(-1)?.pop.title).toBe('six');

    dismissAllPops();
    expect(get(popQueue)).toEqual([]);
  });
});
