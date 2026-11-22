import { expect, it } from 'vitest';
import { sameEdition } from './collection';

it('reconnaît une même édition malgré la marque, la casse ou la plateforme', () => {
  expect(sameEdition('TUNIC', 'Tunic')).toBe(true);
  expect(sameEdition('DARK SOULS™ III', 'DARK SOULS III')).toBe(true);
  expect(sameEdition('Dead Island 2', 'Dead Island 2 (Windows)')).toBe(true);
  expect(sameEdition('BioShock', 'BioShock Remastered')).toBe(false);
});
