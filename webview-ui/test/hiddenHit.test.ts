import { describe, expect, it } from 'vitest';

import { createCharacter } from '../src/office/engine/characters.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { CharacterState } from '../src/office/types.js';

describe('getCharacterAt and the agent filter', () => {
  function office() {
    const os = new OfficeState();
    const a = createCharacter(1, 0, null, null);
    const b = createCharacter(2, 1, null, null);
    for (const ch of [a, b]) {
      ch.state = CharacterState.IDLE;
      ch.x = 40;
      ch.y = 40;
      ch.matrixEffect = null;
    }
    b.x = 80;
    os.characters.set(1, a);
    os.characters.set(2, b);
    return os;
  }

  it('hits a visible character', () => {
    const os = office();
    expect(os.getCharacterAt(40, 35)).toBe(1);
  });

  it('never hits a character the filter hides', () => {
    const os = office();
    os.isCharacterHidden = (ch) => ch.id === 1;
    expect(os.getCharacterAt(40, 35)).toBeNull();
    expect(os.getCharacterAt(80, 35)).toBe(2);
  });
});
