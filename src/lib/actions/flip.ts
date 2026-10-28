/**
 * Svelte action: FLIP animation for grid layouts on resize.
 *
 * Polling-based detection: we check element positions every animation frame.
 * When positions change between two frames, we FLIP (First, Last, Invert, Play):
 *   1. OLD positions (from previous frame) and NEW positions (current frame)
 *   2. Apply inverse transform = translate(old - new) to each child
 *   3. Force layout, then zero the transform → children animate to new positions
 *
 * Usage: `<div class="grid" use:gridFlip>`
 */
export function gridFlip(node: HTMLElement) {
	const children = (): HTMLElement[] =>
		Array.from(node.children) as HTMLElement[];

	let prevRects: DOMRect[] = [];
	let rafId: number | null = null;
	let animating = false;

	function getRects() {
		return children().map((el) => el.getBoundingClientRect());
	}

	function flip() {
		const oldRects = prevRects;
		const newRects = getRects();

		if (oldRects.length === 0 || oldRects.length !== newRects.length) {
			prevRects = newRects;
			return;
		}

		const moved: { el: HTMLElement; dx: number; dy: number }[] = [];

		children().forEach((el, i) => {
			const oldRect = oldRects[i];
			const newRect = newRects[i];
			if (!oldRect || !newRect) return;

			const dx = oldRect.left - newRect.left;
			const dy = oldRect.top - newRect.top;

			if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
				el.style.willChange = 'transform';
				el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
				el.style.transition = 'transform 0.35s cubic-bezier(0.25, 0.4, 0.25, 1)';
				moved.push({ el, dx, dy });
			}
		});

		if (moved.length === 0) {
			prevRects = newRects;
			return;
		}

		// Force synchronous layout so the inverse transforms "stick"
		void document.body.offsetHeight;

		// Next frame: clear transforms → children animate to their final positions
		rafId = requestAnimationFrame(() => {
			moved.forEach(({ el }) => {
				el.style.transform = 'translate3d(0, 0, 0)';
			});

			// After transition completes: cleanup + restart polling
			setTimeout(() => {
				moved.forEach(({ el }) => {
					el.style.transition = '';
					el.style.transform = '';
					el.style.willChange = '';
				});
				prevRects = getRects();
				animating = false;
				// Restart the polling loop
				rafId = requestAnimationFrame(loop);
			}, 400);
		});
	}

	let running = false;
	function loop() {
		if (running) return; // safety: prevent re-entry
		running = true;

		const current = getRects();

		if (!animating && prevRects.length > 0 && prevRects.length === current.length) {
			let moved = false;
			for (let i = 0; i < current.length; i++) {
				if (
					Math.abs(prevRects[i].left - current[i].left) > 0.5 ||
					Math.abs(prevRects[i].top - current[i].top) > 0.5
				) {
					moved = true;
					break;
				}
			}

			if (moved) {
				animating = true;
				// prevRects stays as OLD positions — flip() will capture NEW ones
				running = false;
				flip();
				return;
			}
		}

		prevRects = current;
		running = false;
		rafId = requestAnimationFrame(loop);
	}

	// Initial capture
	prevRects = getRects();
	rafId = requestAnimationFrame(loop);

	return {
		destroy() {
			if (rafId) cancelAnimationFrame(rafId);
		},
	};
}
