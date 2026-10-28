/**
 * Svelte action: FLIP animation for grid layouts on window resize.
 *
 * Polling-based detection finds position changes between frames.
 * Then uses the FLIP (First, Last, Invert, Play) technique:
 *   1. Apply inverse transform with `transition: none` (element jumps to old spot)
 *   2. Force reflow
 *   3. Use setTimeout to let browser paint, then enable transition + clear transform
 *   4. Element smoothly animates to its new position
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

		const moved: HTMLElement[] = [];

		// Step 1: Disable transitions, apply inverse transform
		children().forEach((el, i) => {
			const oldRect = oldRects[i];
			const newRect = newRects[i];
			if (!oldRect || !newRect) return;

			const dx = oldRect.left - newRect.left;
			const dy = oldRect.top - newRect.top;

			if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
				el.style.willChange = 'transform';
				el.style.transition = 'none';
				el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
				moved.push(el);
			}
		});

		if (moved.length === 0) {
			prevRects = newRects;
			return;
		}

		// Step 2: Force synchronous reflow
		void document.body.offsetHeight;

		// Step 3: Let browser paint the inverse-transformed state, THEN
		// enable transition and clear transform to trigger the animation.
		// setTimeout(0) runs as a new task, allowing a paint between here
		// and the callback.
		setTimeout(() => {
			moved.forEach((el) => {
				el.style.transition = 'transform 0.35s cubic-bezier(0.25, 0.4, 0.25, 1)';
				el.style.transform = 'translate3d(0, 0, 0)';
			});

			// Cleanup after transition completes
			setTimeout(() => {
				moved.forEach((el) => {
					el.style.transition = '';
					el.style.transform = '';
					el.style.willChange = '';
				});
				prevRects = getRects();
				animating = false;
				rafId = requestAnimationFrame(loop);
			}, 400);
		}, 0);
	}

	let running = false;
	function loop() {
		if (running) return;
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
