// Décrite par scene.json : ce script ne fait que charger le moteur commun.
(() => {
  const folder = new URL('.', document.currentScript.src);
  let scene;
  (window.AchieversCards ??= {})['grand-theft-auto-v'] = {
    async mount(canvas, level = 3) {
      const render = await (scene ??= import(new URL('../shared/card-engine.js', folder)).then(
        ({ loadCardScene }) => loadCardScene(folder),
      ));
      return render(canvas, level);
    },
  };
})();
