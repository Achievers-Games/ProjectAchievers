// @vitest-environment happy-dom
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeChat,
  dockChats,
  isChatOpen,
  noteFoldedChat,
  openChat,
  persistChats,
  renameChat,
} from './chat';

beforeEach(() => {
  localStorage.clear();
  dockChats.set([]);
});

describe('fenêtres de discussion', () => {
  it('ouvre une discussion, sans doublon, et rouvre une fenêtre repliée', () => {
    openChat('a', 'Léa', true);
    openChat('b', 'Marco');
    openChat('a', 'Léa');

    expect(get(dockChats)).toEqual([
      { id: 'a', title: 'Léa', folded: false, pending: 0 },
      { id: 'b', title: 'Marco', folded: false },
    ]);
    expect(isChatOpen('a')).toBe(true);
    expect(isChatOpen('c')).toBe(false);
  });

  it('ne garde que trois fenêtres et laisse partir la plus ancienne', () => {
    for (const id of ['a', 'b', 'c', 'd']) openChat(id, id.toUpperCase());

    expect(get(dockChats).map((chat) => chat.id)).toEqual(['b', 'c', 'd']);
  });

  it('compte les messages d’une fenêtre repliée seulement', () => {
    openChat('a', 'Léa', true);
    openChat('b', 'Marco');

    noteFoldedChat('a');
    noteFoldedChat('a');
    noteFoldedChat('b');

    expect(get(dockChats)[0]?.pending).toBe(2);
    expect(get(dockChats)[1]?.pending).toBeUndefined();
  });

  it('renomme et ferme une discussion', () => {
    openChat('a', 'Léa');
    renameChat('a', 'Léa B.');
    expect(get(dockChats)[0]?.title).toBe('Léa B.');

    closeChat('a');
    expect(get(dockChats)).toEqual([]);
  });

  it('retrouve les fenêtres du joueur au rechargement', () => {
    openChat('a', 'Léa', true);
    const stop = persistChats('joueur-1');
    stop();

    dockChats.set([]);
    persistChats('joueur-1')();

    expect(get(dockChats)).toEqual([{ id: 'a', title: 'Léa', folded: true }]);
  });

  it('ignore les fenêtres enregistrées par un autre joueur', () => {
    openChat('a', 'Léa');
    persistChats('joueur-1')();

    dockChats.set([]);
    persistChats('joueur-2')();

    expect(get(dockChats)).toEqual([]);
  });
});
