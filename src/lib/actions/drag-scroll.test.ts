// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { dragScroll } from './drag-scroll';

function setup() {
  const rail = document.createElement('div');
  document.body.append(rail);
  const onDrag = vi.fn();
  const action = dragScroll(rail, { onDrag });
  return { rail, onDrag, destroy: () => action.destroy() };
}

const pointer = (type: string, x: number, extra: PointerEventInit = {}) =>
  new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, ...extra });

const drag = (rail: HTMLElement, from: number, to: number) => {
  rail.dispatchEvent(pointer('pointerdown', from));
  rail.dispatchEvent(pointer('pointermove', to));
  rail.dispatchEvent(pointer('pointerup', to));
};

const click = (rail: HTMLElement) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  rail.dispatchEvent(event);
  return event;
};

describe('glisser à la souris', () => {
  it('suit le pointeur et prévient du début et de la fin du geste', () => {
    const { rail, onDrag } = setup();
    rail.scrollLeft = 100;

    rail.dispatchEvent(pointer('pointerdown', 300));
    rail.dispatchEvent(pointer('pointermove', 200));

    expect(rail.scrollLeft).toBe(200);
    expect(rail.dataset.dragging).toBe('true');
    expect(onDrag).toHaveBeenLastCalledWith(true);

    rail.dispatchEvent(pointer('pointerup', 200));
    expect(onDrag).toHaveBeenLastCalledWith(false);
  });

  it('laisse un clic franc ouvrir la carte-liens du rail', () => {
    const { rail } = setup();
    const link = document.createElement('a');
    rail.append(link);
    const capture = vi.fn();
    Object.assign(rail, { setPointerCapture: capture, releasePointerCapture: vi.fn() });

    // Un clic pose le pointeur et le relâche sans bouger. La capture du pointeur n'est alors
    // jamais prise : dans un navigateur, elle redirigerait le `click` vers le rail et le lien
    // resterait sans effet.
    link.dispatchEvent(pointer('pointerdown', 300));
    link.dispatchEvent(pointer('pointerup', 300));
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(capture).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('capture le pointeur dès que le glissement commence', () => {
    const { rail } = setup();
    const capture = vi.fn();
    Object.assign(rail, { setPointerCapture: capture, releasePointerCapture: vi.fn() });

    drag(rail, 300, 200);

    expect(capture).toHaveBeenCalledWith(1);
  });

  it('ne bouge pas avant quelques pixels : un clic reste un clic', () => {
    const { rail, onDrag } = setup();
    rail.dispatchEvent(pointer('pointerdown', 300));
    rail.dispatchEvent(pointer('pointermove', 296));
    expect(rail.scrollLeft).toBe(0);
    expect(onDrag).not.toHaveBeenCalled();
    expect(click(rail).defaultPrevented).toBe(false);
  });

  it('avale le clic qui suit un glissement, puis oublie le geste', async () => {
    const { rail } = setup();
    drag(rail, 300, 100);

    expect(click(rail).defaultPrevented).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rail.dataset.dragging).toBeUndefined();
    expect(click(rail).defaultPrevented).toBe(false);
  });

  it('empêche le glisser-déposer natif des cartes-liens', () => {
    const { rail } = setup();
    const event = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    rail.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('laisse le tactile défiler nativement', () => {
    const { rail, onDrag } = setup();
    rail.dispatchEvent(pointer('pointerdown', 300, { pointerType: 'touch' }));
    rail.dispatchEvent(pointer('pointermove', 100, { pointerType: 'touch' }));
    expect(rail.scrollLeft).toBe(0);
    expect(onDrag).not.toHaveBeenCalled();
  });

  it('libère ses écouteurs à la destruction', () => {
    const { rail, onDrag, destroy } = setup();
    destroy();
    drag(rail, 300, 100);
    expect(onDrag).not.toHaveBeenCalled();
    expect(rail.scrollLeft).toBe(0);
  });
});
