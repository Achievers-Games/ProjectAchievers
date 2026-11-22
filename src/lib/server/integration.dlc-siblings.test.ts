// Tests sur un vrai PostgreSQL : les DLC repris de la version PlayStation du même jeu.
import 'dotenv/config';
import { beforeEach, describe, expect, it } from 'vitest';
import { setCardsOpeningForTests } from './cards-launch';
import { db } from './db';
import {
  dlcName,
  inferGroups,
  inferSiblingDlc,
  resetSiblingDlc,
  type NamedAchievement,
} from './dlc-siblings';
import { saveAchievements, saveProgress, type AchievementInput } from './sync/store';
import { PREFIX, setupIntegration } from './test-helpers';

setupIntegration();
beforeEach(() => {
  resetSiblingDlc();
  setCardsOpeningForTests(new Date(0));
});

const named = (name: string, groupId: string | null = null, groupName = ''): NamedAchievement => ({
  platformAchievementId: name,
  name,
  groupId,
  groupName,
  platinum: name === 'Platine',
});

describe('découpage PlayStation', () => {
  it('reprend les DLC par le nom des succès, sans le platine', () => {
    const psn = [
      named('Platine', 'default'),
      named('Premier pas', 'default'),
      named('Le boss', 'default'),
      named('Sous-sol', '001', 'Trophées pour la Fondation'),
      named('L’ascenseur', '001', 'Trophées pour la Fondation'),
    ];
    const steam = ['Premier pas', 'LE BOSS !', 'Sous-sol', "L'ascenseur"].map((name) =>
      named(name),
    );
    const result = inferGroups(steam, psn)!;
    expect(result.coverage).toBe(1);
    expect([...result.groups]).toEqual([
      ['Sous-sol', { groupId: 'psn:001', groupName: 'La Fondation' }],
      ["L'ascenseur", { groupId: 'psn:001', groupName: 'La Fondation' }],
    ]);
  });

  it('écarte un autre jeu, un DLC absent et un nom ambigu', () => {
    const psn = [
      named('A', 'default'),
      named('B', 'default'),
      named('C', 'default'),
      named('D', '001', 'Un'),
      named('E', '001', 'Un'),
      named('F', '001', 'Un'),
    ];
    expect(inferGroups([named('A'), named('X'), named('Y')], psn)).toBeNull();
    expect(
      inferGroups(
        ['A', 'B', 'C', 'D'].map((name) => named(name)),
        psn,
      )!.groups.size,
    ).toBe(0);
    const twice = [...psn, named('A', '002', 'Deux'), named('G', '002', 'Deux')];
    const groups = inferGroups(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name) => named(name)),
      twice,
    )!.groups;
    expect(groups.has('A')).toBe(false);
    expect(groups.get('G')?.groupId).toBe('psn:002');
  });

  it('nomme le DLC sans répéter le jeu', () => {
    expect(dlcName('Trophées pour la Fondation')).toBe('La Fondation');
    expect(dlcName('DOOM Eternal®: The Ancient Gods', 'DOOM Eternal®')).toBe('The Ancient Gods');
    expect(dlcName('Borderlands 2', 'Borderlands')).toBe('Borderlands 2');
    expect(dlcName('Cyberpunk 2077', 'Cyberpunk 2077')).toBe('Cyberpunk 2077');
  });
});

async function game(platform: 'STEAM' | 'PSN' | 'XBOX', familyKey: string) {
  return db.game.create({
    data: {
      platform,
      platformGameId: `${PREFIX}-${crypto.randomUUID()}`,
      name: `${PREFIX} Control`,
      slug: `${PREFIX}-${crypto.randomUUID()}`,
      familyKey,
      familyLocked: true,
    },
  });
}

const list = (
  names: string[],
  group?: (name: string) => { groupId: string; groupName: string },
): AchievementInput[] =>
  names.map((name) => ({
    platformAchievementId: name,
    name,
    description: '',
    hidden: false,
    trophyType: 'ACHIEVEMENT',
    globalRarity: 80,
    ...group?.(name),
  }));

const groupsOf = async (gameId: string) =>
  Object.fromEntries(
    (
      await db.achievement.findMany({
        where: { gameId },
        select: { name: true, groupId: true },
      })
    ).map((row) => [row.name, row.groupId]),
  );

const base = () => ({ groupId: 'default', groupName: '' });
const psnGroup = (name: string) =>
  name.startsWith('DLC') ? { groupId: '001', groupName: 'La Fondation' } : base();

describe('DLC repris de PlayStation', () => {
  it('sépare Steam et Xbox, paie le jeu de base fini, et survit aux relectures de Steam', async () => {
    const family = `${PREFIX}-${crypto.randomUUID()}`;
    const names = ['A', 'B', 'DLC 1', 'DLC 2'];
    const [steam, xbox, psn] = await Promise.all([
      game('STEAM', family),
      game('XBOX', family),
      game('PSN', family),
    ]);
    await saveAchievements(steam!.id, list(names, base));
    await saveAchievements(xbox!.id, list(names));
    await saveAchievements(psn!.id, list(names, psnGroup));
    const user = await db.user.create({
      data: {
        handle: `${PREFIX}-${crypto.randomUUID()}`,
        displayName: PREFIX,
        shardsFrom: new Date('2026-06-01'),
      },
    });
    await saveProgress(
      user.id,
      steam!.id,
      ['A', 'B'].map((name) => ({
        platformAchievementId: name,
        unlockedAt: new Date('2026-06-02'),
      })),
    );
    const bonus = () => db.shardEntry.count({ where: { userId: user.id, reason: 'COMPLETION' } });
    expect(await bonus()).toBe(0);

    await inferSiblingDlc();
    const separated = { A: 'default', B: 'default', 'DLC 1': 'psn:001', 'DLC 2': 'psn:001' };
    expect(await groupsOf(steam!.id)).toEqual(separated);
    expect(await groupsOf(xbox!.id)).toEqual(separated);
    expect(await bonus()).toBe(1);

    // Steam ne connaît qu'un groupe : sa relecture ne défait rien, et rien ne se paie deux fois.
    await saveAchievements(steam!.id, list(names, base));
    expect(await groupsOf(steam!.id)).toEqual(separated);
    await inferSiblingDlc();
    expect(await bonus()).toBe(1);

    // L'éditeur finit par publier ses DLC : son découpage remplace celui de PlayStation.
    await saveAchievements(
      steam!.id,
      list(names, (name) =>
        name.startsWith('DLC') ? { groupId: 'dlc:5', groupName: 'Fondation' } : base(),
      ),
    );
    await inferSiblingDlc();
    expect((await groupsOf(steam!.id))['DLC 1']).toBe('dlc:5');
  });

  it('rend un succès au jeu de base quand PlayStation ne le sépare plus', async () => {
    const family = `${PREFIX}-${crypto.randomUUID()}`;
    const names = ['A', 'B', 'DLC 1'];
    const [steam, psn] = await Promise.all([game('STEAM', family), game('PSN', family)]);
    await saveAchievements(steam!.id, list(names, base));
    await saveAchievements(psn!.id, list(names, psnGroup));
    await inferSiblingDlc();
    expect((await groupsOf(steam!.id))['DLC 1']).toBe('psn:001');

    await saveAchievements(psn!.id, list(names, base));
    await inferSiblingDlc();
    expect((await groupsOf(steam!.id))['DLC 1']).toBe('default');
  });
});
