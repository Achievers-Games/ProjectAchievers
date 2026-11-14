import { describe, expect, it } from 'vitest';
import { eventStream } from './sse';

describe('flux Server-Sent Events', () => {
  it('rend sa place quand le client est parti avant l’ouverture', () => {
    const owner = `test-${Math.random()}`;
    let unsubscribed = 0;
    // Au-delà du plafond par personne : chaque flux mort doit avoir libéré la sienne.
    for (let i = 0; i < 20; i++) {
      const gone = new AbortController();
      gone.abort();
      const response = eventStream(
        () => () => {
          unsubscribed++;
        },
        gone.signal,
        owner,
      );
      expect(response.status).toBe(200);
    }
    expect(unsubscribed).toBe(20);
  });
});
