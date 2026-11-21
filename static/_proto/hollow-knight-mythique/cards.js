// Hollow Knight (Relief et Vivante) est décrite par scene.json : ce script ne fait que charger le
// moteur commun. Le dossier porte le nom « mythique » pour des raisons historiques.
(() => {
  const folder = new URL('.', document.currentScript.src);
  let scene;
  (window.AchieversCards ??= {})['hollow-knight-mythique'] = {
    async mount(canvas, level = 3) {
      const render = await (scene ??= import(new URL('../shared/card-engine.js', folder)).then(
        ({ loadCardScene }) => loadCardScene(folder),
      ));
      return render(canvas, level);
    },
  };
})();
