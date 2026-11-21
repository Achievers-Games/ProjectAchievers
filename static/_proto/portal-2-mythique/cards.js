(() => {
  const folder = new URL('.', document.currentScript.src);
  let scene;
  (window.AchieversCards ??= {})['portal-2-mythique'] = {
    async mount(canvas, level = 3) {
      const render = await (scene ??= import(new URL('../shared/layered-scene.js', folder)).then(
        ({ loadLayeredScene }) => loadLayeredScene(folder),
      ));
      return render(canvas, level);
    },
  };
})();
