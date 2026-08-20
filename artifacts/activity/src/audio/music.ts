// ─────────────────────────────────────────────────────────────────────────────
// Music — a tiny global background-music manager, shared across every scene
// (Menu, World, Duel…). One <audio> element, a playlist, volume + play state
// persisted to localStorage, and skip/next controls. Music by TomMusic.
//
// Autoplay: browsers (and the Discord iframe) block audio until a user gesture.
// start() tries to play immediately; if the browser blocks it, we arm a one-shot
// gesture listener so the first tap/keypress kicks the track off.
// ─────────────────────────────────────────────────────────────────────────────

export interface Track {
  id: string;
  title: string;
  artist: string;
  /** Main (looping) file, relative to the Vite base. */
  src: string;
  /** Optional intro that plays once before the loop (e.g. Journey's intro). */
  intro?: string;
}

// Playlist order. "Journey" opens on the main menu (its intro plays first, then
// the main theme loops). The rest cycle with the skip / next buttons.
export const TRACKS: Track[] = [
  { id: "journey", title: "Journey", artist: "TomMusic", src: "world/music/journey.ogg", intro: "world/music/journey-intro.ogg" },
  { id: "exploration", title: "Exploration", artist: "TomMusic", src: "world/music/exploration.ogg" },
  { id: "magic-forest", title: "A Magic Forest", artist: "TomMusic", src: "world/music/magic-forest.ogg" },
  { id: "safe-space", title: "A Safe Space", artist: "TomMusic", src: "world/music/safe-space.ogg" },
  { id: "battle", title: "Battle Track", artist: "TomMusic", src: "world/music/battle.ogg" },
];

const VOL_KEY = "dn.music.volume";

function assetUrl(rel: string): string {
  const base = typeof import.meta !== "undefined" ? import.meta.env.BASE_URL : "/";
  return `${base}${rel}`;
}

type Listener = () => void;

class MusicManager {
  private audio: HTMLAudioElement | null = null;
  private index = 0;
  private playingIntro = false;
  private volume = 0.6;
  private started = false;
  private wantPlaying = false;
  private readonly listeners = new Set<Listener>();

  private ensureAudio(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const stored = Number(localStorage.getItem(VOL_KEY));
    if (!Number.isNaN(stored) && stored >= 0 && stored <= 1) this.volume = stored;
    const a = new Audio();
    a.preload = "auto";
    a.volume = this.volume;
    a.addEventListener("ended", () => this.onEnded());
    this.audio = a;
    return a;
  }

  /** Begin playback at a given track (default: keep current / first). */
  start(id?: string): void {
    const a = this.ensureAudio();
    this.wantPlaying = true;
    if (id) {
      const i = TRACKS.findIndex((t) => t.id === id);
      if (i >= 0) this.index = i;
    }
    if (!this.started) {
      this.loadCurrent();
      this.started = true;
    }
    this.tryPlay(a);
  }

  private loadCurrent(): void {
    const a = this.ensureAudio();
    const t = TRACKS[this.index]!;
    if (t.intro) {
      this.playingIntro = true;
      a.loop = false;
      a.src = assetUrl(t.intro);
    } else {
      this.playingIntro = false;
      a.loop = true;
      a.src = assetUrl(t.src);
    }
    a.load();
    this.emit();
  }

  private onEnded(): void {
    const a = this.ensureAudio();
    const t = TRACKS[this.index]!;
    if (this.playingIntro && t.intro) {
      // Intro finished → swap to the looping main theme.
      this.playingIntro = false;
      a.loop = true;
      a.src = assetUrl(t.src);
      a.load();
      this.tryPlay(a);
      this.emit();
    }
    // Non-intro tracks loop (a.loop = true), so "ended" won't fire for them.
  }

  private tryPlay(a: HTMLAudioElement): void {
    if (!this.wantPlaying) return;
    a.volume = this.volume;
    const p = a.play();
    if (p && typeof p.then === "function") {
      p.then(() => this.emit()).catch(() => this.armGestureUnlock());
    } else {
      this.emit();
    }
  }

  // Browser blocked autoplay — start on the first user interaction.
  private armGestureUnlock(): void {
    const kick = () => {
      remove();
      if (this.wantPlaying && this.audio) this.tryPlay(this.audio);
    };
    const remove = () => {
      window.removeEventListener("pointerdown", kick, true);
      window.removeEventListener("keydown", kick, true);
      window.removeEventListener("touchstart", kick, true);
    };
    window.addEventListener("pointerdown", kick, true);
    window.addEventListener("keydown", kick, true);
    window.addEventListener("touchstart", kick, true);
    this.emit();
  }

  pause(): void {
    this.wantPlaying = false;
    this.audio?.pause();
    this.emit();
  }

  toggle(): void {
    if (this.isPlaying) this.pause();
    else this.start();
  }

  next(): void {
    this.index = (this.index + 1) % TRACKS.length;
    this.loadCurrent();
    this.wantPlaying = true;
    this.tryPlay(this.ensureAudio());
  }

  prev(): void {
    this.index = (this.index - 1 + TRACKS.length) % TRACKS.length;
    this.loadCurrent();
    this.wantPlaying = true;
    this.tryPlay(this.ensureAudio());
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.audio) this.audio.volume = this.volume;
    try { localStorage.setItem(VOL_KEY, String(this.volume)); } catch { /* private mode */ }
    this.emit();
  }

  getVolume(): number {
    return this.volume;
  }

  get isPlaying(): boolean {
    return !!this.audio && !this.audio.paused && this.wantPlaying;
  }

  current(): Track {
    return TRACKS[this.index]!;
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

/** The single shared music player for the whole Activity. */
export const music = new MusicManager();
