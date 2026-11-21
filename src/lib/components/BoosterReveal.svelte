<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { getLocale } from '#lib/paraglide/runtime';
  import { onMount, type Snippet } from 'svelte';
  import CardBack from '#lib/components/CardBack.svelte';
  import CardInspection from '#lib/components/CardInspection.svelte';
  import ThemedCardFrame from '#lib/components/ThemedCardFrame.svelte';
  import FantasyCardTitle from '#lib/components/FantasyCardTitle.svelte';
  import { cardTilt } from '#lib/card-tilt';
  import { packTear } from '#lib/pack-tear';
  import { dealFromPack, DEAL_DURATION, DEAL_STAGGER } from '#lib/deal-from-pack';
  import { RATES } from '#lib/boosters';
  import {
    animatedCard,
    levelFor,
    loadManifest,
    soundUrl,
    type EditionManifest,
    type Focus,
    type Shot,
  } from '#lib/animated-card';
  import type { BoosterKind, EditionKind } from '#prisma';

  /**
   * L'ouverture d'un booster. Le sachet annonce la meilleure carte par sa lueur, les cartes
   * tombent face cachée et brillent selon leur rareté, puis chacune se retourne. Une Mythique a
   * sa propre scène : un indice par clic, puis le retournement sur des gros plans de la carte
   * animée pendant que le son joue, et la carte entière seulement à la fin. C'est le moment le plus
   * rare du site.
   */
  interface Clues {
    genres: string[];
    achievements: number;
    medianMinutes: number | null;
  }
  interface RevealCard {
    editionId?: string;
    bannerCompletion?: number | null;
    kind: EditionKind;
    duplicate: boolean;
    shards: number;
    game: { name: string; headerUrl: string | null } | null;
    assetPath?: string | null;
    clues?: Clues | null;
  }
  let {
    cards,
    kind,
    onclose,
    next = null,
    collectionHref = null,
    inspectionActions,
  }: {
    cards: RevealCard[];
    kind: BoosterKind;
    onclose: () => void;
    /** Un autre booster est disponible : le récapitulatif propose de l'ouvrir aussitôt. */
    next?: { label: string; open: () => void } | null;
    /** La page de la collection, proposée dans le récapitulatif. */
    collectionHref?: string | null;
    inspectionActions?: Snippet<[RevealCard]>;
  } = $props();
  let openingNext = $state(false);

  const RANK: Record<EditionKind, number> = { RELIEF: 0, VIVANTE: 1, MYTHIQUE: 2 };
  const SOUND_KEY = 'achievers:booster-sound';
  const TEAR = 750;
  /** La Mythique grandit avant le premier indice, entre deux indices, puis après le dernier. */
  const CLUE_START = 700;
  const CLUE_GAP = 1100;
  const CLUE_END = 900;
  /** Courte montée lumineuse de la Vivante avant son retournement. */
  const VIVANTE_CHARGE = 340;
  const AUTO_VIVANTE_CHARGE = 170;
  const AUTO_RELIEF_TURN = 280;
  const AUTO_VIVANTE_TURN = 400;
  const AUTO_SHOT_SCALE = 0.68;
  /**
   * Le fondu au noir entre deux plans : il commence pendant le travelling et atteint le noir
   * complet au moment où le mouvement s'arrête. Le plan suivant ressort du noir plus vite.
   */
  const FADE_IN = 700;
  const FADE_OUT = 300;
  /** Un mouvement de caméra qui démarre et s'arrête en douceur. */
  const EASE = 'cubic-bezier(0.45, 0, 0.55, 1)';
  /**
   * Les plans par défaut, sans manifeste : un travelling horizontal sur le bas de la carte, un
   * travelling vertical sur sa droite, puis un dézoom depuis le centre jusqu'à la carte entière.
   * Chaque plan montre plus large que le précédent : plus on en voit, mieux on la reconnaît.
   */
  const DEFAULT_SHOTS: Shot[] = [
    {
      from: { x: 0.02, y: 0.96, zoom: 1.85 },
      to: { x: 0.38, y: 0.96, zoom: 1.85 },
      duration: 1700,
    },
    {
      from: { x: 0.96, y: 0.15, zoom: 1.65 },
      to: { x: 0.96, y: 0.65, zoom: 1.65 },
      duration: 1700,
    },
    { from: { x: 0.5, y: 0.45, zoom: 1.5 }, to: { x: 0.5, y: 0.5, zoom: 1 }, duration: 1900 },
  ];

  type Phase = 'charge' | 'focus' | 'burst';

  let dialog = $state<HTMLDialogElement>();
  let stage = $state<'pack' | 'tearing' | 'unpacking' | 'cards' | 'mythique' | 'done'>('pack');
  let packNode = $state<HTMLButtonElement>();
  let packRect = $state<{ x: number; y: number; width: number; height: number } | null>(null);
  let phase = $state<Phase>('charge');
  let introPending = $state(false);
  let teased = $state(0);
  /** Ce que montre la caméra (point visé et zoom), et la durée du mouvement en cours. */
  let view = $state<Focus | null>(null);
  let moving = $state(0);
  let blackout = $state(false);
  let revealed = $state<boolean[]>([]);
  let autoTurned = $state<boolean[]>([]);
  /** Les Vivantes en préparation, juste avant leur retournement. */
  let charging = $state<boolean[]>([]);
  let sound = $state(true);
  let reduced = $state(false);
  let manifest = $state<EditionManifest | null>(null);
  let dealing = $state(false);
  let settling = $state<boolean[]>([]);
  let animationKey = $state<number[]>([]);
  let cardNodes = $state<HTMLButtonElement[]>([]);
  let inspectedIndex = $state<number | null>(null);
  const inspectionIndices = $derived(cards.flatMap((_, index) => (revealed[index] ? [index] : [])));
  let autoIndex: number | null = null;
  let sceneId = 0;
  let mythiqueIndex = $state<number | null>(null);
  let spotlight = $state<number | null>(null);
  let pending = $state<number | null>(null);
  let autoReveal = $state(false);
  let autoQueue: number[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const later = (run: () => void, delay: number) => timers.push(setTimeout(run, delay));
  const cameraTimers: ReturnType<typeof setTimeout>[] = [];
  let cameraFrame = 0;
  const cameraLater = (run: () => void, delay: number) =>
    cameraTimers.push(
      setTimeout(() => {
        if (phase === 'focus') run();
      }, delay),
    );

  function stopCamera() {
    cameraTimers.splice(0).forEach(clearTimeout);
    cancelAnimationFrame(cameraFrame);
  }

  const best = $derived(
    cards.reduce<EditionKind>(
      (top, card) => (RANK[card.kind] > RANK[top] ? card.kind : top),
      'RELIEF',
    ),
  );
  const mythique = $derived(
    mythiqueIndex === null ? cards.find((card) => card.kind === 'MYTHIQUE') : cards[mythiqueIndex],
  );
  /** Une carte qui déclare une intro la joue à la place des plans de caméra. */
  const revealInIntro = $derived(!reduced && Boolean(manifest?.intro));
  /** Le manifeste de chaque carte du booster : style du titre, cadre. */
  let cardManifests = $state<(EditionManifest | null)[]>([]);
  $effect(() => {
    const paths = cards.map((card) => card.assetPath ?? null);
    void Promise.all(paths.map((path) => (path ? loadManifest(path) : null))).then((loaded) => {
      if (paths.every((path, index) => path === (cards[index]?.assetPath ?? null)))
        cardManifests = loaded;
    });
  });

  function finishCardIntro() {
    if (!introPending || mythiqueIndex === null) return;
    revealed[mythiqueIndex] = true;
    introPending = false;
  }

  function watchCardIntro(node: HTMLElement) {
    node.addEventListener('card-intro-reveal', finishCardIntro);
    return { destroy: () => node.removeEventListener('card-intro-reveal', finishCardIntro) };
  }
  const gained = $derived(cards.reduce((sum, card) => sum + card.shards, 0));
  const fresh = $derived(cards.filter((card) => !card.duplicate).length);
  const duplicates = $derived(cards.filter((card) => card.duplicate));

  const editionName: Record<EditionKind, () => string> = {
    RELIEF: () => m.edition_relief(),
    VIVANTE: () => m.edition_vivante(),
    MYTHIQUE: () => m.edition_mythique(),
  };
  const percent = (value: number, digits = 2) =>
    new Intl.NumberFormat(getLocale(), {
      style: 'percent',
      maximumFractionDigits: digits,
    }).format(value);
  const odds = $derived(percent(RATES[kind].MYTHIQUE));
  const genreName = (key: string) =>
    (m as unknown as Record<string, (() => string) | undefined>)[`genre_${key}`]?.() ?? key;

  /** Les indices d'une Mythique, un par clic : le genre, le nombre de succès, le temps du 100 %. */
  const teasers = $derived.by((): string[] => {
    const clues = mythique?.clues;
    if (!clues) return [];
    const items: string[] = [];
    if (clues.genres.length)
      items.push(m.booster_clue_genre({ genre: clues.genres.map(genreName).join(' · ') }));
    if (clues.achievements) items.push(m.booster_clue_achievements({ count: clues.achievements }));
    if (clues.medianMinutes)
      items.push(m.booster_clue_time({ hours: Math.max(1, Math.round(clues.medianMinutes / 60)) }));
    return items;
  });
  const shownTeasers = $derived(teasers.slice(0, teased));
  /** La montée de la Mythique dure le temps de lire ses indices, un par un. */
  const clueStart = $derived(autoReveal ? 260 : CLUE_START);
  const clueGap = $derived(autoReveal ? 520 : CLUE_GAP);
  const charge = $derived(
    clueStart + Math.max(0, teasers.length - 1) * clueGap + (autoReveal ? 380 : CLUE_END),
  );
  const vivanteCharge = $derived(autoReveal ? AUTO_VIVANTE_CHARGE : VIVANTE_CHARGE);
  const fadeIn = $derived(autoReveal ? 390 : FADE_IN);
  const fadeOut = $derived(autoReveal ? 240 : FADE_OUT);
  const shots = $derived(manifest?.shots?.length ? manifest.shots : DEFAULT_SHOTS);
  const revealFrame = $derived(manifest?.frame ?? null);

  // Particules fixes : la même gerbe à chaque fois, calculée une seule fois.
  const burst = (count: number, reach: number) =>
    Array.from({ length: count }, (_, index) => ({
      angle: (index / count) * 360 + ((index * 37) % 17),
      distance: reach * (0.55 + ((index * 53) % 45) / 100),
      size: 3 + ((index * 29) % 5),
      delay: (index * 11) % 120,
    }));
  const smallBurst = burst(26, 150);
  const bigBurst = burst(72, 420);
  const embers = Array.from({ length: 40 }, (_, index) => ({
    left: (index * 37) % 100,
    delay: (index * 53) % 2600,
    duration: 2600 + ((index * 97) % 2200),
    drift: ((index * 71) % 160) - 80,
  }));

  // Sons synthétisés : rien à charger, et rien ne joue avant un geste du joueur.
  let audio: AudioContext | undefined;
  let output: GainNode | undefined;
  let gameSound: HTMLAudioElement | undefined;
  function tone(freq: number, at: number, duration: number, type: OscillatorType, gain: number) {
    if (!audio || !output) return;
    const osc = audio.createOscillator();
    const env = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(env).connect(output);
    osc.start(at);
    osc.stop(at + duration + 0.05);
  }
  function rustle(at: number, duration: number, frequency: number, volume: number) {
    if (!audio || !output) return;
    const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const envelope = audio.createGain();
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(frequency, at);
    filter.frequency.exponentialRampToValueAtTime(frequency * 0.5, at + duration);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(volume, at + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter).connect(envelope).connect(output);
    source.start(at);
  }
  function play(
    effect: 'tear' | 'deal' | 'flip' | 'swell' | 'vivante' | 'charge' | 'clue' | 'mythique',
  ) {
    if (!sound) return;
    try {
      audio ??= new AudioContext();
      if (!output) {
        output = audio.createGain();
        output.connect(audio.destination);
      }
      if (audio.state === 'suspended') void audio.resume().catch(() => {});
    } catch {
      return;
    }
    const at = audio.currentTime;
    if (effect === 'tear') {
      const pitch = 0.92 + Math.random() * 0.16;
      rustle(at, 0.19, 1700 * pitch, 0.16);
      rustle(at + 0.09, 0.38, 3100 * pitch, 0.26);
      rustle(at + 0.37, 0.28, 2250 * pitch, 0.15);
    } else if (effect === 'deal') {
      rustle(at, 0.14, 1400 + Math.random() * 500, 0.16);
      tone(180 + Math.random() * 45, at + 0.045, 0.07, 'sine', 0.035);
    } else if (effect === 'flip') {
      const strike = at + (reduced ? 0 : autoReveal ? 0.16 : 0.3);
      tone(880, strike, 0.22, 'sine', 0.075);
      tone(2137, strike, 0.13, 'sine', 0.032);
      tone(3461, strike, 0.08, 'sine', 0.017);
    } else if (effect === 'clue') {
      // Chaque indice monte d'un ton : la tension grimpe avec eux.
      tone(392 * 2 ** (teased / 6), at, 0.5, 'sine', 0.07);
      tone(784 * 2 ** (teased / 6), at + 0.04, 0.35, 'triangle', 0.03);
    } else if (effect === 'swell') {
      // Une montée courte qui annonce la Vivante.
      const osc = audio.createOscillator();
      const env = audio.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, at);
      const end = at + vivanteCharge / 1000;
      osc.frequency.exponentialRampToValueAtTime(520, end);
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(0.05, end);
      env.gain.exponentialRampToValueAtTime(0.0001, end + 0.08);
      osc.connect(env).connect(output);
      osc.start(at);
      osc.stop(end + 0.1);
    } else if (effect === 'vivante') {
      const awake = at + (reduced ? 0 : autoReveal ? 0.13 : 0.22);
      [392, 587, 784, 988].forEach((freq, i) => tone(freq, awake + i * 0.19, 0.9, 'sine', 0.046));
    } else if (effect === 'charge') {
      const osc = audio.createOscillator();
      const env = audio.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110, at);
      osc.frequency.exponentialRampToValueAtTime(660, at + charge / 1000);
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(0.04, at + charge / 1000);
      env.gain.exponentialRampToValueAtTime(0.0001, at + charge / 1000 + 0.1);
      osc.connect(env).connect(output);
      osc.start(at);
      osc.stop(at + charge / 1000 + 0.15);
    } else {
      [523, 659, 784, 1047, 1319, 1568].forEach((freq, i) =>
        tone(freq, at + i * 0.07, 1.8, 'triangle', 0.07),
      );
      tone(130, at, 1.6, 'sine', 0.12);
    }
  }
  /** Le son propre au jeu, s'il en a un ; sinon la fanfare de la Mythique. */
  function stopGameSound() {
    gameSound?.pause();
    gameSound = undefined;
  }

  function playReveal(withTravelling: boolean) {
    if (!sound) return;
    if (withTravelling && mythique?.assetPath && manifest?.sound) {
      const clip = new Audio(soundUrl(mythique.assetPath, manifest.sound));
      gameSound = clip;
      clip.volume = 0.65;
      clip.play().catch(() => {
        if (gameSound !== clip) return;
        stopGameSound();
        play('mythique');
      });
    } else play('mythique');
  }

  function toggleSound() {
    sound = !sound;
    if (output) output.gain.value = Number(sound);
    if (!sound) stopGameSound();
    try {
      localStorage.setItem(SOUND_KEY, sound ? 'on' : 'off');
    } catch {
      // Sans stockage, le choix vaut pour cette ouverture.
    }
  }

  onMount(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    reduced = motion.matches;
    const updateMotion = () => (reduced = motion.matches);
    motion.addEventListener('change', updateMotion);
    try {
      sound = localStorage.getItem(SOUND_KEY) !== 'off';
    } catch {
      sound = true;
    }
    revealed = cards.map(() => false);
    autoTurned = cards.map(() => false);
    charging = cards.map(() => false);
    settling = cards.map(() => false);
    animationKey = cards.map(() => 0);
    if (mythique?.assetPath)
      void loadManifest(mythique.assetPath).then((loaded) => {
        if (mythiqueIndex === null) manifest = loaded;
      });
    // La page en dessous ne défile pas, et ses barres de défilement disparaissent pendant la scène.
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    dialog?.showModal();
    return () => {
      motion.removeEventListener('change', updateMotion);
      root.style.overflow = overflow;
      timers.forEach(clearTimeout);
      stopCamera();
      stopGameSound();
      void audio?.close();
    };
  });

  function tear() {
    if (stage !== 'pack') return;
    play('tear');
    stage = 'tearing';
    later(
      () => {
        const rect = packNode?.getBoundingClientRect();
        packRect = rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
        stage = reduced ? 'cards' : 'unpacking';
        dealing = !reduced;
        if (!reduced) {
          cards.forEach((_, index) =>
            later(() => play('deal'), DEAL_DURATION * 0.34 + index * DEAL_STAGGER),
          );
          later(
            () => {
              dealing = false;
              stage = 'cards';
              if (autoReveal) nextAuto();
            },
            DEAL_DURATION + (cards.length - 1) * DEAL_STAGGER + 100,
          );
        }
      },
      reduced ? 0 : TEAR,
    );
  }

  function selectCard(index: number) {
    if (dealing || charging[index] || settling[index] || pending === index) return;
    autoReveal = false;
    autoIndex = null;
    autoQueue = [];
    spotlight = null;
    if (revealed[index]) {
      inspectedIndex = index;
      return;
    }
    flip(index);
  }

  function moveInspection(direction: number) {
    if (inspectedIndex === null || !inspectionIndices.length) return;
    const current = inspectionIndices.indexOf(inspectedIndex);
    inspectedIndex =
      inspectionIndices[
        (current + direction + inspectionIndices.length) % inspectionIndices.length
      ]!;
  }

  function replayInspectionReveal() {
    if (inspectedIndex === null) return;
    const index = inspectedIndex;
    inspectedIndex = null;
    flip(index);
  }

  function flip(index: number, automatic = false) {
    if (
      (stage !== 'cards' && stage !== 'done') ||
      dealing ||
      settling[index] ||
      pending === index ||
      charging[index]
    )
      return;
    if (
      automatic &&
      !reduced &&
      cards[index]!.kind !== 'RELIEF' &&
      revealed.filter(Boolean).length === cards.length - 1
    ) {
      spotlight = index;
      pending = index;
      play('swell');
      later(() => {
        pending = null;
        if (stage === 'cards') beginFlip(index);
      }, 160);
      return;
    }
    beginFlip(index);
  }

  function beginFlip(index: number) {
    const card = cards[index]!;
    autoTurned[index] = autoReveal;
    if (card.kind === 'MYTHIQUE') {
      stopGameSound();
      mythiqueIndex = index;
      settling[index] = true;
      const scene = ++sceneId;
      manifest = null;
      if (card.assetPath)
        void loadManifest(card.assetPath).then((loaded) => {
          if (mythiqueIndex === index) manifest = loaded;
        });
      stage = 'mythique';
      phase = 'charge';
      introPending = false;
      teased = 0;
      play('charge');
      // Les indices tombent seuls pendant que la carte grandit, puis elle se retourne.
      teasers.forEach((_, i) =>
        later(
          () => {
            if (scene !== sceneId || phase !== 'charge') return;
            teased = i + 1;
            play('clue');
          },
          clueStart + i * clueGap,
        ),
      );
      later(
        () => {
          if (scene === sceneId) revealMythique();
        },
        reduced ? 0 : charge,
      );
      return;
    }
    if (card.kind === 'VIVANTE' && !reduced) {
      charging[index] = true;
      play('swell');
      later(() => {
        charging[index] = false;
        turn(index);
      }, vivanteCharge);
      return;
    }
    turn(index);
  }

  function turn(index: number) {
    settling[index] = true;
    revealed[index] = true;
    animationKey[index]++;
    cardNodes[index]?.querySelector('canvas')?.dispatchEvent(new Event('achievers:card-replay'));
    const vivante = cards[index]!.kind === 'VIVANTE';
    play(vivante ? 'vivante' : 'flip');
    later(
      () => {
        settling[index] = false;
        if (spotlight === index) spotlight = null;
        finishCard(index);
      },
      reduced ? 0 : autoTurned[index] ? (vivante ? AUTO_VIVANTE_TURN : AUTO_RELIEF_TURN) : 900,
    );
  }

  function maybeFinish() {
    if (
      stage === 'cards' &&
      revealed.every(Boolean) &&
      !charging.some(Boolean) &&
      !settling.some(Boolean) &&
      pending === null
    ) {
      autoReveal = false;
      autoIndex = null;
      stage = 'done';
    }
  }

  function finishCard(index: number) {
    if (autoIndex === index) {
      autoIndex = null;
      if (autoReveal && stage === 'cards') nextAuto();
    }
    maybeFinish();
  }

  /** Un clic pendant les indices ou les plans affiche directement la carte complète. */
  function advanceMythique() {
    if (phase === 'charge' || phase === 'focus') finishMythique();
  }

  /**
   * Le retournement ne montre pas encore la carte : elle se retourne déjà en gros plan, et le son
   * du jeu accompagne les plans de caméra. Chaque plan est un mouvement continu (travelling ou
   * dézoom), séparé du suivant par un fondu au noir. Le dernier finit sur la carte entière.
   */
  function revealMythique() {
    if (phase !== 'charge') return;
    if (reduced || revealInIntro) {
      finishMythique();
      return;
    }
    revealed[mythiqueIndex!] = true;
    // Le cadrage est posé dans le même rendu que le retournement : aucune frame en plan large.
    moving = 0;
    view = shots[0]!.from;
    blackout = true;
    phase = 'focus';
    playReveal(true);
    let at = 0;
    shots.forEach((plan, step) => {
      const shot = autoReveal
        ? { ...plan, duration: Math.round(plan.duration * AUTO_SHOT_SCALE) }
        : plan;
      if (step === 0) startShot(shot);
      else cameraLater(() => startShot(shot), at);
      cameraLater(() => (blackout = false), at + (step === 0 ? 120 : 40));
      at += shot.duration;
      // Le fondu commence pendant la fin du mouvement : la caméra bouge encore quand tout noircit.
      if (step < shots.length - 1) cameraLater(() => (blackout = true), Math.max(0, at - fadeIn));
    });
    cameraLater(finishMythique, at);
  }

  /** Pose la caméra au départ du plan sans transition, puis lance son mouvement. */
  function startShot(shot: Shot) {
    if (phase !== 'focus') return;
    moving = 0;
    view = shot.from;
    cameraFrame = requestAnimationFrame(() => {
      if (phase !== 'focus') return;
      cameraFrame = requestAnimationFrame(() => {
        if (phase !== 'focus') return;
        moving = shot.duration;
        view = shot.to;
      });
    });
  }

  function finishMythique() {
    stopCamera();
    stopGameSound();
    if (phase === 'burst') return;
    if (phase === 'charge') {
      const index = mythiqueIndex!;
      if (!revealInIntro) revealed[index] = true;
      playReveal(false);
    }
    moving = 0;
    view = null;
    blackout = false;
    if (revealInIntro) {
      introPending = true;
      const scene = sceneId;
      // The title still appears if the canvas falls back to the static illustration.
      // L'intro déclare quand elle dévoile la carte : ce filet passe deux secondes après.
      later(
        () => {
          if (scene === sceneId) finishCardIntro();
        },
        (manifest?.intro?.revealAt ?? 4000) + 2000,
      );
    }
    phase = 'burst';
  }

  function leaveMythique() {
    if (phase !== 'burst') return;
    ++sceneId;
    settling[mythiqueIndex!] = false;
    stage = 'cards';
    spotlight = null;
    finishCard(mythiqueIndex!);
    if (autoReveal && autoIndex === null) nextAuto();
  }

  /** Retourne le reste dans l'ordre de rareté : la meilleure carte arrive toujours en dernier. */
  function revealAll() {
    if (autoReveal) return;
    autoReveal = true;
    autoQueue = cards
      .map((_, index) => index)
      .filter(
        (index) => !revealed[index] && !charging[index] && !settling[index] && pending !== index,
      )
      .toSorted((a, b) => RANK[cards[a]!.kind] - RANK[cards[b]!.kind]);
    if (!dealing) nextAuto();
  }

  function nextAuto() {
    if (!autoReveal || stage !== 'cards' || autoIndex !== null) return;
    let index = autoQueue.shift();
    while (
      index !== undefined &&
      (revealed[index] || charging[index] || settling[index] || pending === index)
    )
      index = autoQueue.shift();
    if (index !== undefined) {
      autoIndex = index;
      flip(index, true);
    } else {
      autoReveal = false;
      maybeFinish();
    }
  }

  function close() {
    dialog?.close();
    onclose();
  }

  function onCancel(event: Event) {
    event.preventDefault();
    if (inspectedIndex !== null) {
      inspectedIndex = null;
      return;
    }
    if (stage === 'pack') tear();
    else if (stage === 'cards') revealAll();
    else if (stage === 'mythique') {
      if (phase === 'burst' && !introPending) leaveMythique();
      else advanceMythique();
    } else if (stage === 'done') close();
  }
</script>

{#snippet art(card: RevealCard, show: boolean)}
  {#if card.game?.headerUrl}<img src={card.game.headerUrl} alt="" />{/if}
  {#if show && card.assetPath}
    <canvas use:animatedCard={{ assetPath: card.assetPath, level: levelFor(card.kind) }}></canvas>
  {/if}
{/snippet}

<dialog
  bind:this={dialog}
  oncancel={onCancel}
  aria-label={m.booster_dialog()}
  class="booster-dialog"
  class:reduced
  data-best={best.toLowerCase()}
  class:spotlit={spotlight !== null}
  class:auto-reveal={autoReveal}
  style:--vivante-charge="{vivanteCharge}ms"
>
  <div class="stage">
    <div class="stars" aria-hidden="true"></div>

    <button
      type="button"
      class="sound"
      onclick={toggleSound}
      aria-pressed={sound}
      aria-label={sound ? m.booster_sound_off() : m.booster_sound_on()}
    >
      {sound ? '♪' : '✕'}
    </button>

    {#if stage === 'pack' || stage === 'tearing' || stage === 'unpacking'}
      <button
        bind:this={packNode}
        type="button"
        class="pack"
        use:cardTilt={!reduced && stage === 'pack'}
        use:packTear={tear}
        class:tearing={stage === 'tearing'}
        class:unpacking={stage === 'unpacking'}
        style:--pack-left="{packRect?.x ?? 0}px"
        style:--pack-top="{packRect?.y ?? 0}px"
        style:--pack-width="{packRect?.width ?? 0}px"
        style:--pack-height="{packRect?.height ?? 0}px"
        data-kind={kind.toLowerCase()}
        onclick={tear}
        disabled={stage !== 'pack'}
        aria-label={m.booster_tap_open()}
      >
        <span class="tilt-surface">
          <span class="aura" aria-hidden="true"></span>
          <span class="pack-seal" aria-hidden="true"></span>
          <span class="pack-body" aria-hidden="true">
            <CardBack edition="RELIEF" />
            <span class="pack-foil"></span>
            <span class="pack-edition"
              >{kind === 'GOLDEN' ? m.boosters_golden() : m.boosters_title()}</span
            >
            <span class="pack-logo">Achievers</span>
            <span class="pack-count">{cards.length}<span class="pack-stack">▱</span></span>
          </span>
          <span class="pack-top" aria-hidden="true"><span>⌄<br />⌄</span></span>
          <span class="pack-fold" aria-hidden="true"></span>
          <span class="leak" aria-hidden="true"></span>
        </span>
      </button>
      {#if stage !== 'unpacking'}<p class="hint">{m.booster_drag_open()}</p>{/if}
    {/if}
    {#if stage !== 'pack' && stage !== 'tearing'}
      <ul
        class="cards"
        data-card-suspended={inspectedIndex !== null ? '' : undefined}
        class:dealing
        class:five={cards.length === 5}
        class:dim={stage === 'mythique'}
        class:has-spotlight={spotlight !== null}
      >
        {#each cards as card, index (index)}
          <li
            class="slot"
            data-card-quality="grid"
            use:dealFromPack={{ from: packRect, index, count: cards.length, enabled: dealing }}
            use:cardTilt={!reduced &&
              inspectedIndex === null &&
              (stage === 'cards' || stage === 'done')}
            class:popped={revealed[index] && card.kind === 'VIVANTE'}
            class:spotlight={spotlight === index}
            class:collected={stage === 'done' && !card.duplicate}
            class:duplicate={stage === 'done' && card.duplicate}
            style:--index={index}
          >
            {#if revealed[index] && card.kind === 'VIVANTE'}
              <span class="halo" aria-hidden="true"></span>
            {/if}
            <span class="tilt-surface">
              <button
                bind:this={cardNodes[index]}
                type="button"
                class="card"
                class:revealed={revealed[index]}
                class:charging={charging[index]}
                class:fast={autoTurned[index]}
                data-edition={card.kind.toLowerCase()}
                onclick={() => selectCard(index)}
                disabled={(stage !== 'cards' && stage !== 'done') ||
                  dealing ||
                  settling[index] ||
                  pending === index ||
                  charging[index]}
                aria-label={revealed[index]
                  ? `${card.game?.name ?? ''} · ${editionName[card.kind]()}`
                  : m.booster_tap_card()}
              >
                <span class="back" aria-hidden="true"><CardBack edition={card.kind} /></span>
                <span class="front">
                  <span class="art">
                    <!-- Ne pas compiler le rendu WebGL entre deux retournements automatiques. -->
                    {@render art(
                      card,
                      revealed[index] === true &&
                        !settling[index] &&
                        (!autoReveal || !autoTurned[index]),
                    )}
                    {#if revealed[index] && card.kind === 'VIVANTE'}
                      {#key animationKey[index]}<span class="wake" aria-hidden="true"></span>{/key}
                    {/if}
                  </span>
                  <span class="frame-light" aria-hidden="true"></span>
                  {#if revealed[index] && card.kind === 'RELIEF'}
                    {#key animationKey[index]}<span class="glint" aria-hidden="true"></span>{/key}
                  {/if}
                  {#if cardManifests[index]?.title === 'fantasy'}
                    <FantasyCardTitle name={card.game?.name ?? '—'} compact />
                  {:else}
                    <span class="front-ornament" aria-hidden="true">✦</span>
                    <span class="plaque">
                      <span class="name">{card.game?.name ?? '—'}</span>
                      <span class="badge">{editionName[card.kind]()}</span>
                    </span>
                  {/if}
                </span>
              </button>
            </span>
            {#if revealed[index] && stage !== 'mythique'}
              <span class="result-status" class:is-duplicate={card.duplicate}>
                {card.duplicate ? m.boosters_duplicate({ count: card.shards }) : m.boosters_new()}
              </span>
            {/if}
            {#if stage === 'done' && card.duplicate && !reduced}
              <span class="shard-cloud" aria-hidden="true">
                {#each smallBurst.slice(0, 12) as p, i (i)}
                  <i
                    style:--angle="{p.angle}deg"
                    style:--distance="{p.distance * 0.65}px"
                    style:--delay="{p.delay}ms"
                  ></i>
                {/each}
              </span>
            {/if}
            {#if revealed[index] && card.kind !== 'MYTHIQUE'}
              <span class="ring" aria-hidden="true"></span>
              {#if card.kind === 'VIVANTE'}
                <span class="burst" aria-hidden="true">
                  {#each smallBurst as p, i (i)}
                    <i
                      style:--angle="{p.angle}deg"
                      style:--distance="{p.distance}px"
                      style:--size="{p.size}px"
                      style:--delay="{p.delay}ms"
                    ></i>
                  {/each}
                </span>
                <span class="stamp" aria-hidden="true">{m.edition_vivante()}</span>
              {/if}
              {#if card.duplicate}<span class="gain" aria-hidden="true">+{card.shards}</span>{/if}
            {/if}
          </li>
        {/each}
      </ul>

      {#if stage === 'cards' || stage === 'unpacking'}
        <p class="hint" class:waiting={stage === 'unpacking'}>{m.booster_tap_card()}</p>
        <button
          type="button"
          class="btn"
          class:waiting={stage === 'unpacking'}
          disabled={stage === 'unpacking' || autoReveal}
          onclick={revealAll}>{m.booster_reveal_all()}</button
        >
      {:else if stage === 'done'}
        <!-- Les nouvelles cartes rejoignent la collection ; les doublons fondent en éclats. -->
        <section class="collection-recap" aria-live="polite">
          <div class="collection-tray">
            <h3 class="recap-label">{m.booster_recap_new({ count: fresh })}</h3>
            <ul class="collection-miniatures">
              {#each cards.filter((card) => !card.duplicate) as card, index (index)}
                <li
                  class="collection-mini"
                  data-edition={card.kind.toLowerCase()}
                  style:--index={index}
                  title="{card.game?.name ?? '—'} · {editionName[card.kind]()}"
                >
                  {#if card.game?.headerUrl}<img
                      src={card.game.headerUrl}
                      alt="{card.game.name} · {editionName[card.kind]()}"
                    />{:else}<span>✦</span>{/if}
                </li>
              {/each}
              {#if fresh === 0}<li class="empty-collection">—</li>{/if}
            </ul>
          </div>
          {#if duplicates.length}
            <div class="collection-tray duplicates">
              <h3 class="recap-label">
                {m.booster_recap_duplicates({ count: duplicates.length })}
              </h3>
              <ul class="collection-miniatures">
                {#each duplicates as card, index (index)}
                  <li
                    class="collection-mini is-duplicate"
                    style:--index={fresh + index}
                    title="{card.game?.name ?? '—'} · {m.boosters_duplicate({
                      count: card.shards,
                    })}"
                  >
                    {#if card.game?.headerUrl}<img
                        src={card.game.headerUrl}
                        alt="{card.game.name} · {m.boosters_duplicate({ count: card.shards })}"
                      />{:else}<span>✦</span>{/if}
                    <span class="mini-gain" aria-hidden="true">+{card.shards}</span>
                  </li>
                {/each}
              </ul>
              <p class="shard-total">
                <span aria-hidden="true">◆</span>{m.booster_recap_recycled({ count: gained })}
              </p>
            </div>
          {/if}
        </section>
        <div class="recap-actions">
          {#if next}
            <button
              type="button"
              class="btn btn-primary"
              disabled={openingNext}
              onclick={() => {
                openingNext = true;
                next.open();
              }}>{next.label}</button
            >
          {/if}
          {#if collectionHref}
            <a href={collectionHref} class="btn" onclick={close}>{m.collection_link()}</a>
          {/if}
          <button type="button" class="btn" class:btn-primary={!next} onclick={close}
            >{m.booster_close()}</button
          >
        </div>
      {/if}
    {/if}

    {#if stage === 'mythique' && mythique}
      <div
        class="mythique"
        class:intro-pending={introPending}
        data-phase={phase}
        data-atmosphere={manifest?.atmosphere ?? 'sparks'}
        style:--game-glow={manifest?.glow ?? '#fbbf24'}
        role="presentation"
      >
        <div class="rays" aria-hidden="true"></div>
        <div class="flash" aria-hidden="true"></div>
        {#if phase === 'burst' && !introPending}
          <div class="burst big" aria-hidden="true">
            {#each bigBurst as p, i (i)}
              <i
                style:--angle="{p.angle}deg"
                style:--distance="{p.distance}px"
                style:--size="{p.size + 2}px"
                style:--delay="{p.delay}ms"
              ></i>
            {/each}
          </div>
          <div class="embers" aria-hidden="true">
            {#each embers as ember, i (i)}
              <span
                style:left="{ember.left}%"
                style:--drift="{ember.drift}px"
                style:animation-delay="{ember.delay}ms"
                style:animation-duration="{ember.duration}ms"
              ></span>
            {/each}
          </div>
        {/if}

        {#if phase === 'charge'}
          <!-- Les indices au-dessus de la carte, du plus vague au plus parlant. -->
          <ul class="clues" aria-live="polite">
            {#each shownTeasers as clue, i (i)}<li class="clue">{clue}</li>{/each}
          </ul>
        {/if}

        <button
          type="button"
          class="hero"
          use:cardTilt={!reduced && phase !== 'focus'}
          onclick={advanceMythique}
          disabled={phase === 'burst'}
          aria-label={m.booster_tap_flip()}
        >
          <span class="tilt-surface">
            <span class="hero-card" class:flipped={phase !== 'charge'} style:--charge="{charge}ms">
              <span class="back" aria-hidden="true"><CardBack edition="MYTHIQUE" /></span>
              <span class="front mythique-front" data-frame-theme={revealFrame ?? undefined}>
                <span
                  class="lens"
                  use:watchCardIntro
                  data-card-quality="close-up"
                  data-card-intro={phase === 'burst' && !reduced && revealInIntro ? '' : undefined}
                  style:transform-origin={view ? `${view.x * 100}% ${view.y * 100}%` : '50% 50%'}
                  style:transform={view ? `scale(${view.zoom})` : 'none'}
                  style:transition={moving
                    ? `transform ${moving}ms ${EASE}, transform-origin ${moving}ms ${EASE}`
                    : 'none'}
                >
                  {@render art(mythique, phase !== 'charge')}
                </span>
                {#if phase === 'focus'}<span class="holo" aria-hidden="true"></span>{/if}
                <span class="frame-light" aria-hidden="true"></span>
                {#if !revealFrame}
                  <span class="front-ornament" aria-hidden="true">✦</span>
                {/if}
                {#if phase === 'burst' && !introPending}
                  {#if revealFrame}
                    <FantasyCardTitle
                      name={mythique.game?.name ?? '—'}
                      theme={revealFrame}
                      reveal
                    />
                  {:else}
                    <span class="plaque"
                      ><span class="name">{mythique.game?.name ?? '—'}</span><span class="badge"
                        >{m.edition_mythique()}</span
                      ></span
                    >
                  {/if}
                {/if}
                <!-- Le noir passe au-dessus du reflet : rien ne brille pendant le fondu. -->
                <span
                  class="blackout"
                  class:on={blackout}
                  style:transition-duration="{blackout ? fadeIn : fadeOut}ms"
                  aria-hidden="true"
                ></span>
              </span>
              {#if phase === 'burst' && revealFrame && !introPending}
                <span class="hero-themed-frame"
                  ><ThemedCardFrame theme={revealFrame} kind="MYTHIQUE" reveal /></span
                >
              {/if}
            </span>
          </span>
        </button>

        {#if phase === 'focus'}
          <button type="button" class="btn skip" onclick={finishMythique}>
            {m.reveal_skip()}
          </button>
        {/if}

        {#if phase === 'burst'}
          <div class="mythique-text" inert={introPending} aria-live="assertive">
            <p class="title">
              {#each m.booster_mythique_title().split('') as letter, i (i)}
                <!-- Une lettre animée faite d'un seul espace s'écraserait : espace insécable. -->
                <span style:--i={i}>{letter === ' ' ? ' ' : letter}</span>
              {/each}
            </p>
            <p class="game">{mythique.game?.name ?? ''}</p>
            <p class="odds">{m.booster_mythique_odds({ odds })}</p>
            {#if mythique.duplicate}
              <p class="odds">{m.boosters_duplicate({ count: mythique.shards })}</p>
            {/if}
            <button type="button" class="btn btn-primary" onclick={leaveMythique}>
              {m.booster_continue()}
            </button>
          </div>
        {/if}
      </div>
    {/if}
    {#if inspectedIndex !== null}
      <CardInspection
        card={cards[inspectedIndex]!}
        position={inspectionIndices.indexOf(inspectedIndex) + 1}
        total={inspectionIndices.length}
        status={cards[inspectedIndex]!.duplicate
          ? m.boosters_duplicate({ count: cards[inspectedIndex]!.shards })
          : m.boosters_new()}
        onclose={() => (inspectedIndex = null)}
        onprevious={() => moveInspection(-1)}
        onnext={() => moveInspection(1)}
        onreplay={() =>
          play(
            cards[inspectedIndex!]!.kind === 'MYTHIQUE'
              ? 'mythique'
              : cards[inspectedIndex!]!.kind === 'VIVANTE'
                ? 'vivante'
                : 'flip',
          )}
        onreveal={replayInspectionReveal}
      >
        {#snippet actions()}
          {@render inspectionActions?.(cards[inspectedIndex!]!)}
        {/snippet}
      </CardInspection>
    {/if}
  </div>
</dialog>

<style>
  @property --peel {
    syntax: '<number>';
    inherits: true;
    initial-value: 0;
  }
  @property --turn {
    syntax: '<angle>';
    inherits: false;
    initial-value: 0deg;
  }
  .booster-dialog {
    --relief: #60a5fa;
    --vivante: #a78bfa;
    --mythique: #fbbf24;
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    color: white;
    background: radial-gradient(ellipse at 50% 45%, #1b1533 0%, #07060c 70%);
    overflow-x: hidden;
    overflow-y: auto;
  }
  .booster-dialog::backdrop {
    background: rgb(0 0 0 / 0.85);
  }
  .stage {
    position: relative;
    display: flex;
    min-height: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.25rem;
    padding: 2rem 1rem;
  }
  .stars {
    position: absolute;
    inset: 0;
    background-image:
      radial-gradient(1px 1px at 20% 30%, white 50%, transparent 51%),
      radial-gradient(1px 1px at 70% 20%, white 50%, transparent 51%),
      radial-gradient(1.5px 1.5px at 40% 80%, white 50%, transparent 51%),
      radial-gradient(1px 1px at 85% 65%, white 50%, transparent 51%),
      radial-gradient(1px 1px at 10% 75%, white 50%, transparent 51%),
      radial-gradient(1.5px 1.5px at 55% 50%, white 50%, transparent 51%);
    opacity: 0.45;
    animation: twinkle 4s ease-in-out infinite alternate;
    pointer-events: none;
  }
  .sound {
    position: absolute;
    top: 1rem;
    right: 1rem;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 999px;
    border: 1px solid rgb(255 255 255 / 0.25);
    background: rgb(255 255 255 / 0.06);
    color: white;
    z-index: 20;
  }
  .hint {
    position: relative;
    margin: 0;
    font-size: 0.9rem;
    color: rgb(255 255 255 / 0.75);
  }

  /* Le sachet. Sa lueur annonce la meilleure carte, comme une étoile filante. */
  .pack {
    --glow: var(--relief);
    --pack-ink: #8be7ee;
    position: relative;
    width: min(620px, 86vw, 115vh);
    aspect-ratio: 2 / 1;
    perspective: 1200px;
    border: 0;
    background: none;
    padding: 0;
    cursor: pointer;
    touch-action: none;
    user-select: none;
    animation: float 3s ease-in-out infinite;
  }
  .pack > .tilt-surface {
    position: absolute;
    inset: 0;
  }
  .pack:focus-visible {
    outline: 2px solid var(--pack-ink);
    outline-offset: 12px;
    border-radius: 12px;
  }
  .pack:global([data-dragging]) {
    animation: none;
  }
  .pack:global([data-dragging]) .leak {
    opacity: calc(var(--peel) * 1.6);
  }
  .pack[data-kind='golden'] {
    --pack-ink: #e8cd91;
  }
  .booster-dialog[data-best='vivante'] .pack {
    --glow: var(--vivante);
  }
  .booster-dialog[data-best='mythique'] .pack {
    --glow: var(--mythique);
  }
  .aura {
    position: absolute;
    inset: -30%;
    border-radius: 50%;
    background: radial-gradient(
      circle,
      color-mix(in srgb, var(--glow) 55%, transparent),
      transparent 65%
    );
    filter: blur(10px);
    animation: pulse 1.6s ease-in-out infinite;
  }
  .pack-top,
  .pack-seal {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 7%;
    background:
      repeating-linear-gradient(0deg, #ffffff12 0 1px, transparent 1px 5px),
      linear-gradient(90deg, #101923, #4e6472 48%, #17232d 72%, #080e16);
    border: 1px solid color-mix(in srgb, var(--pack-ink) 45%, #26323d);
    box-shadow: inset 0 0 12px #0009;
  }
  .pack-seal {
    left: 0;
    border-radius: 4px 0 0 4px;
  }
  .pack-top {
    right: 0;
    width: 9%;
    z-index: 3;
    display: grid;
    place-items: center;
    border-radius: 0 4px 4px 0;
    border-left: 1px dashed var(--pack-ink);
    clip-path: inset(calc(var(--peel) * 100%) 0 0);
    cursor: grab;
  }
  .pack-top > span {
    position: absolute;
    top: 5%;
    color: var(--pack-ink);
    font-size: clamp(12px, 2vw, 20px);
    line-height: 0.7;
    text-shadow: 0 0 12px var(--pack-ink);
  }
  .pack-fold {
    position: absolute;
    right: 0;
    top: 0;
    z-index: 5;
    width: 9%;
    height: 100%;
    transform-origin: top center;
    transform: translateY(calc(var(--peel) * 100%))
      rotate(calc(var(--peel) * -32deg + var(--peel-side, 0deg))) skewX(calc(var(--peel) * 8deg))
      scaleY(var(--peel));
    opacity: min(1, calc(var(--peel) * 12));
    background:
      linear-gradient(170deg, #03070d 0%, #d6e5ec 5%, #6c818d 12%, transparent 28%),
      repeating-linear-gradient(0deg, #ffffff18 0 1px, transparent 1px 5px),
      linear-gradient(110deg, #21343e, #d5e4ea 38%, #758c98 65%, #e3edf2 82%, #30434e);
    border: 1px solid #c6dce8;
    border-radius: 35% 65% 22% 40% / 4% 12% 24% 18%;
    box-shadow:
      -6px 8px 12px #0009,
      inset 0 2px 3px #ffffffbb;
    pointer-events: none;
  }
  .pack-fold::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background:
      radial-gradient(ellipse at 0% 72%, #0007, transparent 65%),
      linear-gradient(90deg, transparent 72%, #fff8 86%, #0005);
  }
  .pack-body {
    position: absolute;
    inset: 0 9% 0 6%;
    overflow: hidden;
    border-block: 1px solid color-mix(in srgb, var(--pack-ink) 60%, #26323d);
    border-radius: 5px;
    background: #101017;
    box-shadow:
      0 18px 35px #0009,
      0 0 35px color-mix(in srgb, var(--glow) 30%, transparent);
  }
  .pack-body :global(.card-back) {
    inset: 8% -1%;
  }
  .pack-foil {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg, #0008, transparent 7% 92%, #000a),
      linear-gradient(180deg, #ffffff22, transparent 4% 94%, #ffffff28),
      linear-gradient(112deg, transparent 32%, #bfe9ff20 45%, #ffffff38 49%, transparent 57%);
    background-size:
      100% 100%,
      100% 100%,
      250% 100%;
    background-position:
      0 0,
      0 0,
      var(--foil-x, 50%) 50%;
    mix-blend-mode: screen;
  }
  .pack[data-kind='golden'] .pack-foil {
    background-color: #d4a54a20;
    mix-blend-mode: lighten;
  }
  .pack-edition,
  .pack-logo,
  .pack-count {
    position: absolute;
    color: var(--pack-ink);
    text-shadow: 0 2px 5px #000;
  }
  .pack-edition {
    top: 4%;
    left: 8%;
    font-size: clamp(8px, 1.4vw, 11px);
    text-transform: uppercase;
    letter-spacing: 0.25em;
  }
  .pack-logo {
    bottom: 2%;
    left: 50%;
    transform: translateX(-50%);
    font-weight: 800;
    font-style: italic;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: clamp(11px, 2.1vw, 17px);
  }
  .pack-count {
    right: 8%;
    top: 3%;
    display: flex;
    align-items: center;
    gap: 0.35em;
    font-size: clamp(12px, 2vw, 18px);
    font-weight: 800;
  }
  .pack-stack {
    font-size: 1.4em;
  }
  .leak {
    position: absolute;
    right: 8%;
    top: 0;
    height: calc(var(--peel) * 100%);
    width: 4px;
    background: var(--glow);
    filter: blur(6px);
    opacity: 0;
  }
  .pack.tearing {
    animation: peel-open 0.6s cubic-bezier(0.2, 0.6, 0.3, 1) forwards;
  }
  .pack.tearing .pack-fold {
    animation: fold-fade 0.65s ease forwards;
  }
  .pack.tearing .leak {
    animation: leak 0.75s ease-out forwards;
  }
  .pack.unpacking {
    position: fixed;
    left: var(--pack-left);
    top: var(--pack-top);
    width: var(--pack-width);
    height: var(--pack-height);
    aspect-ratio: auto;
    z-index: 6;
    pointer-events: none;
    animation: empty-pack 650ms ease 850ms both;
  }
  .pack.unpacking .pack-top,
  .pack.unpacking .pack-fold,
  .pack.unpacking .leak {
    display: none;
  }
  .pack.unpacking::after {
    content: '';
    position: absolute;
    right: 8.5%;
    top: 6%;
    height: 88%;
    width: 1.5%;
    border-left: 1px solid #cce8f0;
    border-radius: 50%;
    background: #02050b;
    box-shadow:
      -5px 0 10px #0009,
      2px 0 8px #8be7ee55;
  }
  .waiting {
    visibility: hidden;
  }

  /* Les cartes : l'illustration garde le format des cartes animées (920 × 430). */
  .cards {
    position: relative;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: clamp(0.5rem, 2vw, 1.25rem);
    width: min(980px, 100%);
    margin: 0;
    padding: 0;
    list-style: none;
    transition:
      opacity 0.4s,
      filter 0.4s;
  }
  .cards.dim {
    opacity: 0.15;
    filter: blur(3px);
  }
  .cards.five {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
  .cards.five > .slot {
    grid-column: span 2;
  }
  .cards.five > .slot:nth-child(4) {
    grid-column: 2 / span 2;
  }
  .cards.five > .slot:nth-child(5) {
    grid-column: 4 / span 2;
  }
  .slot {
    position: relative;
    perspective: 1200px;
    transition:
      filter 400ms ease,
      opacity 400ms ease;
    padding-bottom: 1.6rem;
  }
  .cards.dealing {
    pointer-events: none;
  }
  .cards.has-spotlight .slot:not(.spotlight) {
    filter: brightness(0.25) blur(1px);
    opacity: 0.5;
  }
  .spotlit {
    background: radial-gradient(ellipse at 50% 45%, #132833 0%, #030409 70%);
  }
  .slot.spotlight {
    z-index: 4;
  }
  .slot.spotlight > .tilt-surface {
    transform: translateY(-18px) scale(1.08);
  }
  .card:focus-visible {
    outline: 2px solid #b3f4ff;
    outline-offset: 6px;
    border-radius: 0.9rem;
  }
  .card {
    --edition: var(--relief);
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 920 / 600;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    transform-style: preserve-3d;
    transform: rotateY(0deg);
    transition: transform 0.48s cubic-bezier(0.32, 0.1, 0.35, 1);
  }
  .tilt-surface {
    display: block;
    transform-style: preserve-3d;
    transform: translateY(var(--hover-lift, 0px)) rotateX(var(--tilt-x, 0deg))
      rotateY(var(--tilt-y, 0deg));
  }
  :global([data-tilting] > .tilt-surface) {
    will-change: transform;
  }
  .slot:global([data-tilting]) {
    z-index: 3;
  }
  .card[data-edition='vivante'] {
    --edition: var(--vivante);
  }
  .card[data-edition='mythique'] {
    --edition: var(--mythique);
  }
  .card:disabled {
    cursor: default;
    /* Une opacité inférieure à 1 aplatit le recto-verso dans Chromium. */
    opacity: 1;
  }
  .card.revealed {
    transform: rotateY(180deg);
  }
  .back,
  .front {
    position: absolute;
    inset: 0;
    border-radius: 0.9rem;
    backface-visibility: hidden;
    overflow: hidden;
  }
  .back {
    display: grid;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--edition) 70%, white);
    background: #101017;
    box-shadow: 0 0 18px color-mix(in srgb, var(--edition) 45%, transparent);
  }
  .card[data-edition='vivante'] .back {
    animation: glow 1.4s ease-in-out infinite;
  }
  /* La Vivante se soulève et s'illumine, sans tremblement. */
  .card.charging {
    animation: swell var(--vivante-charge) ease-out forwards;
  }
  .card.charging .back {
    animation: none;
    transition: box-shadow var(--vivante-charge) ease;
    box-shadow: 0 0 46px var(--vivante);
  }
  /* Retournée, elle bondit vers l'avant avant de se reposer. */
  .slot.popped .card {
    animation: pop 0.7s cubic-bezier(0.3, 0.08, 0.35, 1) both;
  }
  .card.fast {
    transition-duration: 240ms;
  }
  .slot.popped .card.fast {
    animation-duration: 360ms;
  }
  .card.fast.revealed[data-edition='vivante'] .art,
  .card.fast .wake {
    animation-delay: 130ms;
  }
  .slot.popped {
    z-index: 2;
  }
  /* Son aura tourne derrière elle, tant que la scène reste ouverte. */
  .halo {
    position: absolute;
    inset: -7px;
    bottom: calc(1.6rem - 7px);
    border-radius: 1.1rem;
    background: conic-gradient(
      from var(--turn, 0deg),
      var(--vivante),
      #f0abfc,
      #22d3ee,
      var(--vivante),
      transparent 70%,
      var(--vivante)
    );
    filter: blur(4px);
    opacity: 1;
    pointer-events: none;
    animation:
      halo-in 0.6s ease-out both,
      halo-spin 2.4s linear infinite;
  }
  /*
   * La Relief : un reflet métallique bref traverse toute la carte, cadre compris, comme une
   * plaque d'acier qu'on incline sous la lumière ; le liseré s'allume au passage.
   */
  .glint {
    position: absolute;
    inset: 0;
    z-index: 6;
    border-radius: inherit;
    background: linear-gradient(
      100deg,
      transparent 38%,
      #dceaf522 44%,
      #f5faffd0 48.5%,
      #8fa9bd70 50.5%,
      #ffffffa0 52%,
      transparent 58%
    );
    background-size: 260% 100%;
    background-position: 100% 0;
    mix-blend-mode: screen;
    pointer-events: none;
    animation: glint 0.75s cubic-bezier(0.4, 0, 0.3, 1) 0.32s both;
  }
  .glint::after {
    content: '';
    position: absolute;
    inset: 0;
    padding: 2px;
    border-radius: inherit;
    background: linear-gradient(100deg, #8fb3c8, #ffffff 50%, #8fb3c8);
    mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    mask-composite: exclude;
    animation: glint-edge 0.9s ease-out 0.32s both;
  }
  /*
   * La Vivante s'éveille : l'illustration sort du gris et reprend ses couleurs, tandis qu'une
   * lueur s'épanouit depuis son centre.
   */
  .card.revealed[data-edition='vivante'] .art {
    animation: awaken 1.6s cubic-bezier(0.3, 0, 0.2, 1) 0.25s both;
  }
  .wake {
    position: absolute;
    inset: -20%;
    z-index: 1;
    background: radial-gradient(
      circle at 50% 55%,
      #e6fffbcc 0%,
      #6ff0e466 22%,
      #b37bff33 40%,
      transparent 62%
    );
    mix-blend-mode: screen;
    pointer-events: none;
    animation: wake 1.7s ease-out 0.3s both;
  }
  .card[data-edition='mythique'] .back {
    box-shadow: 0 0 40px var(--mythique);
  }
  .front {
    display: flex;
    flex-direction: column;
    transform: rotateY(180deg);
    border: 1px solid #b9cddf;
    background: linear-gradient(140deg, #d5e5ed, #273d50 3%, #080e16 9% 88%, #668491 96%, #b4ccdb);
    box-shadow: 0 0 30px color-mix(in srgb, var(--edition) 55%, transparent);
    text-align: left;
  }
  .front::before {
    content: '';
    position: absolute;
    inset: 4px;
    z-index: 2;
    border: 1px solid #7bafc3;
    border-radius: 0.6rem;
    pointer-events: none;
    box-shadow: inset 0 0 0 3px #02080bb3;
  }
  .front::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 3;
    background:
      linear-gradient(135deg, #d9f5ff 0%, #638b9d 48%, transparent 50%) top left,
      linear-gradient(225deg, #d9f5ff 0%, #638b9d 48%, transparent 50%) top right,
      linear-gradient(315deg, #d9f5ff 0%, #638b9d 48%, transparent 50%) bottom right,
      linear-gradient(45deg, #d9f5ff 0%, #638b9d 48%, transparent 50%) bottom left;
    background-size: 9% 14%;
    background-repeat: no-repeat;
    pointer-events: none;
  }
  .card[data-edition='vivante'] .front {
    border-color: #89f5ee;
    background: #07131e url('/cards/backs/vivante.webp') center / 100% 100%;
  }
  .card[data-edition='vivante'] .front::before {
    border-color: #7ce8eb;
    box-shadow:
      inset 0 0 12px #22c7da55,
      0 0 5px #62e8c166;
  }
  .card[data-edition='mythique'] .front,
  .mythique-front {
    background: #07111f url('/cards/backs/mythique.webp') center / 100% 100%;
  }
  .card[data-edition='mythique'] .front::before,
  .mythique-front::before {
    border: 2px ridge #bad2df;
    box-shadow:
      inset 0 0 12px #00ccff55,
      0 0 4px #b9f4ff99;
  }
  .front-ornament {
    position: absolute;
    z-index: 4;
    top: -0.25em;
    left: 50%;
    transform: translateX(-50%);
    color: #d1f8ff;
    font-size: clamp(14px, 2vw, 23px);
    text-shadow: 0 0 8px #34cce9;
    pointer-events: none;
  }
  .frame-light {
    position: absolute;
    inset: 0;
    z-index: 5;
    border-radius: inherit;
    padding: 10px;
    background: radial-gradient(
      ellipse at var(--light-x, 50%) var(--light-y, 50%),
      #fff 0%,
      #85e4ff 18%,
      transparent 60%
    );
    mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    mask-composite: exclude;
    opacity: var(--shine, 0);
    mix-blend-mode: color-dodge;
    transition: opacity 300ms ease;
    pointer-events: none;
  }
  .art {
    position: absolute;
    inset: 10px 10px 24%;
    overflow: hidden;
    background: color-mix(in srgb, var(--edition) 25%, black);
    border-radius: 0.4rem;
    box-shadow: inset 0 0 16px #000;
  }
  .art img,
  .lens img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .art img {
    transform: scale(1.035) translate(var(--parallax-x, 0px), var(--parallax-y, 0px));
  }
  .card[data-edition='relief'] .art img {
    transform: scale(1.02)
      translate(calc(var(--parallax-x, 0px) * 0.35), calc(var(--parallax-y, 0px) * 0.35));
  }
  .art canvas {
    transform: scale(1.035);
  }
  .art canvas,
  .lens canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    transition: opacity 0.5s;
  }
  .art :global(canvas[data-ready]),
  .lens :global(canvas[data-ready]) {
    opacity: 1;
  }
  .badge {
    font-size: clamp(7px, 0.7vw, 10px);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-weight: 700;
    color: #a9dce4;
  }
  .plaque {
    position: absolute;
    z-index: 4;
    inset: auto 10% 5%;
    min-height: 17%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 3px;
    padding: 4px 8px;
    border: 1px solid #84a2b780;
    background: linear-gradient(120deg, #142431, #080f19 48%, #243e4c);
    box-shadow:
      0 2px 6px #000b,
      inset 0 1px #d5f1ff40;
    clip-path: polygon(5% 0, 95% 0, 100% 50%, 95% 100%, 5% 100%, 0 50%);
  }
  .name {
    display: block;
    max-width: 100%;
    font-size: clamp(9px, 1vw, 15px);
    font-weight: 600;
    color: #edfaff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .result-status {
    position: absolute;
    bottom: 0;
    inset-inline: 0;
    text-align: center;
    font-size: clamp(9px, 1vw, 12px);
    color: #91ecdc;
    animation: rise-in 450ms ease both;
  }
  .result-status.is-duplicate {
    color: #d5c69d;
  }
  /* Le récapitulatif : les nouvelles cartes d'un côté, les doublons recyclés de l'autre. */
  .collection-recap {
    display: flex;
    align-items: stretch;
    justify-content: center;
    flex-wrap: wrap;
    gap: 1rem 1.75rem;
    width: min(680px, 100%);
    padding: 1rem 1.5rem;
    border: 1px solid #7ddbe638;
    border-radius: 1rem;
    background: linear-gradient(120deg, #0c1f2ee0, #0c131de0);
    box-shadow:
      inset 0 1px #c9f7ff18,
      0 12px 30px #0005;
    animation: rise-in 600ms ease both;
  }
  .collection-tray {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .collection-tray.duplicates {
    padding-left: 1.75rem;
    border-left: 1px solid #7ddbe626;
  }
  .recap-label {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: #c9f2f7;
  }
  .duplicates .recap-label {
    color: #9db3bc;
  }
  .collection-miniatures {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .collection-mini {
    --edition: var(--relief);
    position: relative;
    display: grid;
    place-items: center;
    width: 56px;
    aspect-ratio: 920 / 600;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--edition) 75%, white);
    border-radius: 4px;
    animation: collect 800ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    animation-delay: calc(var(--index) * 130ms);
    box-shadow: 0 0 10px color-mix(in srgb, var(--edition) 40%, transparent);
  }
  .collection-mini[data-edition='vivante'] {
    --edition: var(--vivante);
  }
  .collection-mini[data-edition='mythique'] {
    --edition: var(--mythique);
  }
  .collection-mini img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  /* Un doublon reste visible, éteint : on voit ce qui a été recyclé et ce que ça a rapporté. */
  .collection-mini.is-duplicate {
    border-color: #5d7480;
    box-shadow: none;
  }
  .collection-mini.is-duplicate img {
    filter: grayscale(1) brightness(0.55);
  }
  .mini-gain {
    position: absolute;
    inset: auto 2px 2px auto;
    padding: 0 4px;
    border-radius: 3px;
    background: #061017d9;
    color: #70e8e7;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.4;
  }
  .shard-total {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    color: #e8d8ab;
    font-size: 0.9rem;
    font-weight: 700;
  }
  .shard-total > span {
    color: #70e8e7;
    text-shadow: 0 0 14px #32d9ff;
  }
  .empty-collection {
    color: #66828e;
  }
  .recap-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.6rem;
  }
  .slot.collected > .tilt-surface {
    animation: collection-settle 800ms ease;
  }
  .slot.duplicate > .tilt-surface {
    animation: dissolve 1100ms ease 200ms both;
  }
  .shard-cloud {
    position: absolute;
    top: 45%;
    left: 50%;
    pointer-events: none;
  }
  .shard-cloud i {
    position: absolute;
    width: 7px;
    height: 11px;
    background: #a7f5ff;
    clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
    filter: drop-shadow(0 0 4px #22ccff);
    animation: shoot 1s ease-out calc(300ms + var(--delay)) both;
  }
  .ring {
    position: absolute;
    inset: 10%;
    border-radius: 50%;
    border: 3px solid var(--relief);
    pointer-events: none;
    animation: ring 0.7s ease-out forwards;
  }
  .slot:has([data-edition='vivante']) .ring {
    border-color: var(--vivante);
    border-width: 6px;
    animation-duration: 0.9s;
  }
  .burst {
    position: absolute;
    left: 50%;
    top: 50%;
    pointer-events: none;
  }
  .burst i {
    position: absolute;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    background: var(--vivante);
    box-shadow: 0 0 8px var(--vivante);
    animation: shoot 0.9s ease-out var(--delay) forwards;
  }
  .stamp {
    position: absolute;
    left: 50%;
    top: 40%;
    padding: 0.2rem 0.8rem;
    border: 2px solid var(--vivante);
    border-radius: 0.4rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--vivante);
    background: rgb(0 0 0 / 0.6);
    pointer-events: none;
    animation: stamp 1.6s ease-out forwards;
  }
  .gain {
    position: absolute;
    left: 50%;
    bottom: 20%;
    font-weight: 800;
    color: #fde68a;
    text-shadow: 0 0 8px rgb(0 0 0 / 0.8);
    pointer-events: none;
    animation: gain 1.2s ease-out forwards;
  }

  /* La scène de la Mythique. */
  .mythique {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.25rem;
    padding: 1rem;
  }
  .mythique[data-phase='charge'] {
    background: radial-gradient(
      circle at 50% 42%,
      color-mix(in srgb, var(--game-glow) 10%, transparent),
      transparent 55%
    );
  }
  .mythique[data-phase='burst'] {
    background: radial-gradient(
      circle at 50% 42%,
      color-mix(in srgb, var(--game-glow) 25%, transparent),
      transparent 60%
    );
  }
  .mythique :is(.rays, .flash, .burst.big, .embers) {
    z-index: 0;
  }
  .rays {
    position: absolute;
    left: 50%;
    top: 42%;
    width: 220vmax;
    height: 220vmax;
    margin: -110vmax 0 0 -110vmax;
    background: repeating-conic-gradient(
      color-mix(in srgb, var(--game-glow) 32%, transparent) 0 8deg,
      transparent 8deg 22deg
    );
    mask: radial-gradient(circle, black 0, transparent 55%);
    opacity: 0;
    transition: opacity 0.6s;
    pointer-events: none;
  }
  .mythique[data-phase='burst'] .rays {
    opacity: 1;
    animation: spin 18s linear infinite;
  }
  .flash {
    position: absolute;
    inset: 0;
    background: white;
    opacity: 0;
    pointer-events: none;
  }
  .mythique[data-phase='focus'] .flash,
  .mythique[data-phase='burst'] .flash {
    animation: flash 0.9s ease-out forwards;
  }
  .burst.big {
    top: 42%;
  }
  .burst.big i {
    background: var(--game-glow);
    box-shadow: 0 0 12px var(--game-glow);
    animation-duration: 1.4s;
  }
  .embers {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }
  .embers span {
    position: absolute;
    bottom: -10px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--game-glow);
    box-shadow: 0 0 10px var(--game-glow);
    animation: rise linear infinite;
  }
  .mythique[data-atmosphere='sparks'] .embers span {
    width: 2px;
    height: 12px;
  }
  .mythique[data-atmosphere='wisps'] .embers span {
    width: 8px;
    height: 14px;
    filter: blur(2px);
    opacity: 0.7;
  }
  .mythique[data-atmosphere='ash'] .embers span {
    width: 4px;
    height: 4px;
    border-radius: 1px;
    opacity: 0.6;
  }
  .hero {
    position: relative;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    perspective: 1600px;
    cursor: pointer;
    z-index: 2;
  }
  .hero:disabled {
    cursor: default;
    opacity: 1;
  }
  .hero-card {
    position: relative;
    display: block;
    /* L'image d'un jeu est un bandeau : la carte en grand garde ce format, pour la montrer entière. */
    width: min(560px, 86vw, 90vh);
    aspect-ratio: 920 / 430;
    transform-style: preserve-3d;
    transition: transform 0.9s cubic-bezier(0.2, 1.4, 0.4, 1);
  }
  .mythique[data-phase='charge'] .hero-card {
    animation: charge var(--charge) cubic-bezier(0.5, 0, 0.75, 0.6) forwards;
  }
  .hero-card.flipped {
    transform: rotateY(180deg) scale(1.08);
  }
  .auto-reveal .hero-card {
    transition-duration: 530ms;
  }
  .hero-themed-frame {
    position: absolute;
    inset: 0;
    transform: rotateY(180deg);
    transform-style: preserve-3d;
    pointer-events: none;
  }
  .hero-card .back {
    --edition: var(--mythique);
    box-shadow: 0 0 80px var(--mythique);
  }
  .hero-card .front {
    border: 3px solid var(--mythique);
    box-shadow:
      0 0 60px var(--mythique),
      0 0 140px rgb(251 191 36 / 0.5);
  }
  .hero-card .front .lens {
    inset: 10px;
    overflow: hidden;
    border-radius: 0.5rem;
  }
  .hero-card .front[data-frame-theme] {
    border: 0;
    background: #101d25;
  }
  .hero-card .front[data-frame-theme='underworld'] {
    background: #21131c;
  }
  .hero-card .front[data-frame-theme]::before,
  .hero-card .front[data-frame-theme]::after,
  .hero-card .front[data-frame-theme] .frame-light {
    display: none;
  }
  .hero-card .front[data-frame-theme] .lens {
    inset: 0;
    border-radius: inherit;
  }
  .hero-card .plaque {
    inset-inline: 18%;
    bottom: 4%;
    min-height: 14%;
    background: linear-gradient(120deg, #142431f0, #080f19f0 48%, #243e4cf0);
  }
  /* La caméra : son mouvement est réglé plan par plan, depuis le script. */
  .lens {
    position: absolute;
    inset: 0;
  }
  /* Le fondu au noir entre deux plans. */
  .blackout {
    position: absolute;
    inset: 0;
    background: black;
    opacity: 0;
    transition: opacity 380ms ease-in;
    pointer-events: none;
  }
  .blackout.on {
    opacity: 1;
  }
  /* Pendant les gros plans, la carte prend plus de place : on regarde ses détails de près. */
  .mythique[data-phase='focus'] .hero-card {
    transform: rotateY(180deg) scale(1.25);
  }
  .holo {
    position: absolute;
    inset: 0;
    background: linear-gradient(
        115deg,
        transparent 25%,
        rgb(255 255 255 / 0.55) 40%,
        rgb(147 197 253 / 0.4) 48%,
        rgb(244 114 182 / 0.4) 56%,
        transparent 70%
      )
      0 0 / 250% 100%;
    mix-blend-mode: screen;
    animation: foil 2.2s linear infinite;
    pointer-events: none;
  }
  /* Les indices au-dessus de la carte : rien ne passe derrière elle. */
  .clues {
    position: relative;
    z-index: 3;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem 0.75rem;
    width: min(760px, 94vw);
    min-height: 2.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
    pointer-events: none;
  }
  .clue {
    animation: teaser 0.55s cubic-bezier(0.2, 1.5, 0.4, 1) both;
  }
  .clue {
    display: inline-block;
    padding: 0.4rem 0.8rem;
    border: 1px solid rgb(251 191 36 / 0.6);
    border-radius: 0.6rem;
    font-weight: 700;
    color: #fde68a;
    background: rgb(20 14 2 / 0.75);
    box-shadow: 0 0 18px rgb(251 191 36 / 0.35);
  }
  .skip {
    position: absolute;
    bottom: 8%;
  }
  .mythique-text {
    position: relative;
    z-index: 2;
    text-align: center;
    animation: rise-in 0.6s ease-out 0.4s both;
  }
  .intro-pending .mythique-text {
    animation: none;
    visibility: hidden;
  }
  .intro-pending :is(.rays, .flash) {
    display: none;
  }
  .intro-pending .lens img {
    visibility: hidden;
  }
  .title {
    margin: 0;
    font-size: clamp(2.5rem, 9vw, 5rem);
    font-weight: 900;
    letter-spacing: 0.08em;
    line-height: 1;
    text-transform: uppercase;
    filter: drop-shadow(0 0 18px rgb(251 191 36 / 0.7));
  }
  /* Le dégradé va sur chaque lettre : une lettre animée a son propre calque, que le dégradé
     du titre entier ne traverse pas. */
  .title span {
    display: inline-block;
    background: linear-gradient(180deg, #fff7d6, #fbbf24 55%, #b45309);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: letter 0.5s cubic-bezier(0.2, 1.6, 0.4, 1) both;
    animation-delay: calc(0.5s + var(--i) * 0.05s);
  }
  .game {
    margin: 0.25rem 0 0;
    font-size: 1.25rem;
    font-weight: 700;
  }
  .odds {
    margin: 0.25rem 0 1rem;
    color: rgb(255 255 255 / 0.75);
  }

  @keyframes twinkle {
    to {
      opacity: 0.8;
    }
  }
  @keyframes float {
    50% {
      transform: translateY(-10px);
    }
  }
  @keyframes pulse {
    50% {
      opacity: 0.6;
      scale: 1.08;
    }
  }
  @keyframes foil {
    to {
      background-position:
        -250% 0,
        0 0;
    }
  }
  @keyframes peel-open {
    to {
      --peel: 1;
    }
  }
  @keyframes fold-fade {
    70% {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
  @keyframes leak {
    40% {
      width: 12px;
      opacity: 1;
    }
    to {
      width: 12%;
      opacity: 0;
    }
  }
  @keyframes empty-pack {
    to {
      transform: translate(-4%, 22%) rotate(-4deg) scale(0.94);
      opacity: 0;
    }
  }
  @keyframes collect {
    from {
      opacity: 0;
      transform: translateY(-55px) scale(1.5) rotate(-8deg);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1) rotate(0);
    }
  }
  @keyframes collection-settle {
    45% {
      filter: brightness(1.2);
    }
  }
  @keyframes dissolve {
    30% {
      filter: brightness(1.8) saturate(0.4);
    }
    to {
      opacity: 0.18;
      filter: blur(2px) saturate(0.1);
      transform: scale(0.88) translateY(12px);
    }
  }
  @media (max-width: 640px) {
    .stage {
      padding: 3.5rem 0.75rem 1.5rem;
      gap: 1rem;
    }
    .cards,
    .cards.five {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.5rem;
    }
    .cards.five > .slot,
    .cards.five > .slot:nth-child(4) {
      grid-column: auto;
    }
    .cards.five > .slot:last-child {
      grid-column: 1 / -1;
      width: calc(50% - 0.25rem);
      justify-self: center;
    }
    .front::before {
      inset: 3px;
    }
    .art {
      inset: 7px 7px 25%;
    }
    .plaque {
      inset-inline: 8%;
      padding: 3px 5px;
      gap: 1px;
    }
    .collection-recap {
      padding: 0.8rem;
      gap: 0.8rem;
    }
    .collection-mini {
      width: 42px;
    }
    .collection-tray.duplicates {
      padding: 0.8rem 0 0;
      border-left: 0;
      border-top: 1px solid #7ddbe626;
    }
    .hero-card.flipped {
      transform: rotateY(180deg);
    }
    .mythique[data-phase='focus'] .hero-card {
      transform: rotateY(180deg) scale(1.05);
    }
  }
  @keyframes glow {
    50% {
      box-shadow: 0 0 46px var(--edition);
    }
  }
  @keyframes ring {
    from {
      transform: scale(0.4);
      opacity: 1;
    }
    to {
      transform: scale(2.2);
      opacity: 0;
    }
  }
  @keyframes shoot {
    from {
      transform: rotate(var(--angle)) translateX(0);
      opacity: 1;
    }
    to {
      transform: rotate(var(--angle)) translateX(var(--distance));
      opacity: 0;
    }
  }
  @keyframes swell {
    from {
      transform: translateY(0) rotateY(0deg) scale(1);
    }
    to {
      transform: translateY(-8px) rotateY(0deg) scale(1.08);
    }
  }
  @keyframes pop {
    0% {
      transform: translateY(-8px) rotateY(0deg) scale(1.08);
    }
    38% {
      transform: translateY(-14px) rotateY(108deg) scale(1.13);
    }
    72% {
      transform: translateY(-5px) rotateY(180deg) scale(1.09);
    }
    to {
      transform: translateY(0) rotateY(180deg) scale(1.04);
    }
  }
  @keyframes halo-in {
    from {
      opacity: 0;
      transform: scale(0.85);
    }
  }
  @keyframes halo-spin {
    to {
      --turn: 360deg;
    }
  }
  @keyframes glint {
    from {
      background-position: 100% 0;
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    to {
      background-position: 0 0;
      opacity: 0;
    }
  }
  @keyframes glint-edge {
    from,
    to {
      opacity: 0;
    }
    35% {
      opacity: 0.85;
    }
  }
  @keyframes awaken {
    from {
      filter: grayscale(1) brightness(0.4) contrast(1.15);
    }
    45% {
      filter: grayscale(0.6) brightness(0.75) contrast(1.05);
    }
    to {
      filter: none;
    }
  }
  @keyframes wake {
    from {
      transform: scale(0.15);
      opacity: 0;
    }
    30% {
      opacity: 1;
    }
    to {
      transform: scale(1.5);
      opacity: 0;
    }
  }
  @keyframes stamp {
    0% {
      transform: translate(-50%, -50%) scale(2.4) rotate(-12deg);
      opacity: 0;
    }
    20% {
      transform: translate(-50%, -50%) scale(1) rotate(-8deg);
      opacity: 1;
    }
    80% {
      opacity: 1;
    }
    to {
      transform: translate(-50%, -50%) scale(1) rotate(-8deg);
      opacity: 0;
    }
  }
  @keyframes gain {
    from {
      transform: translate(-50%, 0);
      opacity: 1;
    }
    to {
      transform: translate(-50%, -60px);
      opacity: 0;
    }
  }
  @keyframes charge {
    from {
      transform: scale(0.45);
      filter: brightness(1);
    }
    to {
      transform: scale(1);
      filter: brightness(1.8);
    }
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes flash {
    from {
      opacity: 0.95;
    }
    to {
      opacity: 0;
    }
  }
  @keyframes rise {
    from {
      transform: translate(0, 0);
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    to {
      transform: translate(var(--drift), -105vh);
      opacity: 0;
    }
  }
  @keyframes rise-in {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
  }
  @keyframes letter {
    from {
      opacity: 0;
      transform: translateY(-60px) scale(1.6);
    }
  }
  @keyframes teaser {
    from {
      opacity: 0;
      transform: scale(0.4) translateY(20px);
    }
  }

  /* Réduction des mouvements : pas de tremblement, de secousse ni de particules, des fondus. */
  .reduced *,
  .reduced *::before,
  .reduced *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  .reduced .halo,
  .reduced .card.revealed[data-edition='vivante'] .art {
    animation: none;
  }
  .reduced .glint,
  .reduced .wake,
  .reduced .burst,
  .reduced .embers,
  .reduced .rays,
  .reduced .flash {
    display: none;
  }
</style>
