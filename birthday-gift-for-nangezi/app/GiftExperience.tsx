'use client';

import {
  CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { defaultGiftConfig, GiftConfig } from './gift-config';

type Stage = 'countdown' | 'launch' | 'cake' | 'fireworks' | 'letter' | 'final';
type DisplayMode = 'adaptive' | 'desktop' | 'mobile';
type CalibrationStep = 'sound' | 'gestures' | 'microphone' | 'ready';
type GestureKey = 'openPalm' | 'fist';
type Landmark = { x: number; y: number; z?: number };

const emptyGesturePass: Record<GestureKey, boolean> = { openPalm: false, fist: false };

declare global {
  interface Window {
    Hands?: new (options: { locateFile: (file: string) => string }) => {
      setOptions: (options: Record<string, number | boolean>) => void;
      onResults: (callback: (results: { multiHandLandmarks?: Landmark[][] }) => void) => void;
      initialize: () => Promise<void>;
      send: (input: { image: HTMLVideoElement }) => Promise<void>;
      close: () => Promise<void>;
    };
    webkitAudioContext?: typeof AudioContext;
  }
}

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
const HANDS_ASSET_ROOT = `${BASE_PATH}/vendor/mediapipe/hands`;

function withBasePath(path?: string) {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return path;
  return `${BASE_PATH}${path}`;
}

const gestureNames: Array<{ key: GestureKey; label: string; glyph: string }> = [
  { key: 'openPalm', label: '张开手掌', glyph: '✋' },
  { key: 'fist', label: '握拳', glyph: '●' },
];

const easterBlessings = [
  '愿你一直被真诚的人和事围绕。',
  '愿今天收到的快乐，延续到很久以后。',
  '愿好运正在赶来的路上。',
  '愿所有微小的期待，都有温柔的回音。',
];

function landmarkDistance(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function fingerIsStraight(points: Landmark[], tip: number, pip: number, mcp: number) {
  const towardTip = { x: points[tip].x - points[pip].x, y: points[tip].y - points[pip].y };
  const towardPalm = { x: points[mcp].x - points[pip].x, y: points[mcp].y - points[pip].y };
  const divisor = Math.max(.0001, Math.hypot(towardTip.x, towardTip.y) * Math.hypot(towardPalm.x, towardPalm.y));
  const cosine = (towardTip.x * towardPalm.x + towardTip.y * towardPalm.y) / divisor;
  return cosine < -.48 && landmarkDistance(points[0], points[tip]) > landmarkDistance(points[0], points[pip]) * 1.03;
}

function classifyHandPose(points: Landmark[]): GestureKey | null {
  const palmSize = Math.max(.035, landmarkDistance(points[0], points[9]));
  const straightCount = [[8, 6, 5], [12, 10, 9], [16, 14, 13], [20, 18, 17]]
    .filter(([tip, pip, mcp]) => fingerIsStraight(points, tip, pip, mcp)).length;
  const fingertipRatio = [8, 12, 16, 20]
    .reduce((sum, tip) => sum + landmarkDistance(points[0], points[tip]), 0) / (4 * palmSize);

  if (straightCount >= 3 && fingertipRatio > 1.58) return 'openPalm';
  if (straightCount <= 1 && fingertipRatio < 1.92) return 'fist';
  return null;
}

function readQueryConfig(): GiftConfig {
  if (typeof window === 'undefined') return defaultGiftConfig;
  const query = new URLSearchParams(window.location.search);
  return {
    ...defaultGiftConfig,
    friendName: query.get('name') || defaultGiftConfig.friendName,
    targetDate: query.get('date') || defaultGiftConfig.targetDate,
    age: query.get('age') || defaultGiftConfig.age,
    message: query.get('message') || defaultGiftConfig.message,
  };
}

function getCountdown(target: string) {
  const distance = Math.max(0, new Date(target).getTime() - Date.now());
  return {
    days: Math.floor(distance / 86_400_000),
    hours: Math.floor((distance / 3_600_000) % 24),
    mins: Math.floor((distance / 60_000) % 60),
    secs: Math.floor((distance / 1_000) % 60),
  };
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (window.Hands) {
        resolve();
        return;
      }
      existing.remove();
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('script-load-failed'));
    document.head.appendChild(script);
  });
}

function ParticleWorld({ stage, spread, quality, accent, cyan, pink }: {
  stage: Stage;
  spread: boolean;
  quality: 'high' | 'balanced';
  accent: string;
  cyan: string;
  pink: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let width = window.innerWidth;
    let height = window.innerHeight;
    let pointerX = 0;
    let pointerY = 0;
    const count = quality === 'high' ? (width < 720 ? 440 : 760) : (width < 720 ? 270 : 430);
    const palette = [accent, cyan, pink, '#ffffff'];
    const particles = Array.from({ length: count }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      tx: width / 2,
      ty: height / 2,
      z: .35 + Math.random() * 1.2,
      size: .45 + Math.random() * 1.7,
      color: palette[i % palette.length],
      drift: Math.random() * Math.PI * 2,
    }));

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const center = () => ({
      x: width * (stage === 'final' ? .5 : width > 820 ? .65 : .5),
      y: height * (stage === 'final' ? .5 : width > 820 ? .49 : .35),
      scale: Math.min(width, height) * (stage === 'final' ? (width > 820 ? .36 : .3) : width > 820 ? .24 : .28),
    });

    const retarget = () => {
      const c = center();
      particles.forEach((particle, i) => {
        const t = (i / particles.length) * Math.PI * 2;
        const ring = .38 + ((i * 17) % 100) / 145;
        let x = Math.cos(t * 5) * c.scale * ring;
        let y = Math.sin(t * 3) * c.scale * ring * .72;

        if (stage === 'cake') {
          const segment = i % 10;
          const level = segment < 5 ? 0 : segment < 8 ? 1 : 2;
          const levelWidth = [1, .72, .42][level] * c.scale * 1.5;
          x = (Math.random() - .5) * levelWidth;
          y = c.scale * .52 - level * c.scale * .42 + (Math.random() - .5) * c.scale * .27;
          if (i % 23 === 0) {
            x = (Math.random() - .5) * c.scale * .22;
            y = -c.scale * .8 - Math.random() * c.scale * .36;
          }
        }

        if (stage === 'letter') {
          const edge = i % 4;
          const cardW = c.scale * 1.42;
          const cardH = c.scale * .9;
          if (edge < 2) {
            x = (Math.random() - .5) * cardW;
            y = (edge ? 1 : -1) * cardH / 2 + (Math.random() - .5) * 5;
          } else {
            x = (edge === 2 ? -1 : 1) * cardW / 2 + (Math.random() - .5) * 5;
            y = (Math.random() - .5) * cardH;
          }
        }

        if (stage === 'final') {
          const burstIndex = i % 4;
          const rayIndex = Math.floor(i / 4);
          const spoke = rayIndex % 20;
          const layer = Math.floor(rayIndex / 20) % 11;
          const angle = (spoke / 20) * Math.PI * 2 + burstIndex * .19;
          const radius = c.scale * (.1 + layer * .048 + (i % 3) * .009);
          const burstCenters = [[-.82, -.43], [.82, -.46], [-.72, .48], [.74, .45]];
          x = burstCenters[burstIndex][0] * c.scale + Math.cos(angle) * radius;
          y = burstCenters[burstIndex][1] * c.scale + Math.sin(angle) * radius * .88;
        }

        if (spread) { x *= 1.52; y *= 1.52; }
        particle.tx = c.x + x;
        particle.ty = c.y + y;
      });
    };

    const onPointer = (event: PointerEvent) => {
      pointerX = (event.clientX / width - .5) * 20;
      pointerY = (event.clientY / height - .5) * 16;
    };

    let tick = 0;
    const draw = () => {
      tick += .01;
      ctx.clearRect(0, 0, width, height);
      particles.forEach((particle, i) => {
        const wave = Math.sin(tick * (1.1 + particle.z) + particle.drift) * 2.4;
        particle.x += (particle.tx + pointerX * particle.z - particle.x) * (.018 + particle.z * .01);
        particle.y += (particle.ty + pointerY * particle.z - particle.y) * (.018 + particle.z * .01);
        ctx.beginPath();
        ctx.fillStyle = particle.color;
        ctx.globalAlpha = .2 + particle.z * .48;
        ctx.shadowColor = particle.color;
        ctx.shadowBlur = i % 5 === 0 ? 10 : 2;
        ctx.arc(particle.x + wave, particle.y + wave * .42, particle.size * particle.z, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };

    resize();
    retarget();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointer);
    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointer);
    };
  }, [stage, spread, quality, accent, cyan, pink]);

  return <canvas className="particle-world" ref={canvasRef} aria-hidden="true" />;
}

function FireworksCanvas({ onComplete, onBurst }: { onComplete: () => void; onBurst: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const completeRef = useRef(onComplete);
  const burstRef = useRef(onBurst);
  useEffect(() => { completeRef.current = onComplete; burstRef.current = onBurst; }, [onComplete, onBurst]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let width = window.innerWidth;
    let height = window.innerHeight;
    let raf = 0;
    let lastFrame = 0;
    let elapsed = 0;
    let nextLaunch = 0;
    let settledAt: number | null = null;
    const rockets: Array<{ x: number; y: number; target: number; speed: number; color: string; trail: Array<{ x: number; y: number }> }> = [];
    const sparks: Array<{ x: number; y: number; vx: number; vy: number; life: number; color: string; size: number; trail: Array<{ x: number; y: number }> }> = [];
    const colors = ['#a76bff', '#63f3ff', '#ff5bd7', '#ffd36b', '#ffffff'];

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const launch = (index: number) => {
      const target = height * (.16 + ((index * 17) % 34) / 100);
      rockets.push({
        x: width * (.16 + ((index * 31) % 68) / 100),
        y: height + 20,
        target,
        // Keep tall viewports reachable even with the rocket's easing/drag.
        speed: Math.max(6.4 + (index % 4) * .45, (height + 20 - target) * .009),
        color: colors[index % colors.length],
        trail: [],
      });
    };

    const burst = (rocket: (typeof rockets)[number]) => {
      const amount = width < 700 ? 52 : 82;
      for (let i = 0; i < amount; i += 1) {
        const angle = (i / amount) * Math.PI * 2 + Math.random() * .08;
        const force = 1.5 + Math.random() * 3.7;
        sparks.push({
          x: rocket.x,
          y: rocket.y,
          vx: Math.cos(angle) * force,
          vy: Math.sin(angle) * force,
          life: .9 + Math.random() * .4,
          color: i % 6 === 0 ? '#ffffff' : rocket.color,
          size: .8 + Math.random() * 1.8,
          trail: [],
        });
      }
      burstRef.current();
    };

    const schedule = [180, 780, 1280, 1840, 2380, 3050, 3620, 4210, 4920, 5580];
    const resetFrameClock = () => { lastFrame = 0; };
    const draw = (now: number) => {
      if (document.hidden) {
        lastFrame = 0;
        raf = requestAnimationFrame(draw);
        return;
      }
      // Use visible animation time, not a separate timeout. Slow devices and
      // background tabs must never skip the last rockets or their fading tails.
      const delta = lastFrame ? Math.min(Math.max(0, now - lastFrame), 50) : 0;
      lastFrame = now;
      elapsed += delta;
      const frameStep = delta / (1000 / 60);
      while (nextLaunch < schedule.length && elapsed >= schedule[nextLaunch]) {
        launch(nextLaunch);
        nextLaunch += 1;
      }
      ctx.clearRect(0, 0, width, height);
      for (let i = rockets.length - 1; i >= 0; i -= 1) {
        const rocket = rockets[i];
        rocket.trail.unshift({ x: rocket.x, y: rocket.y });
        rocket.trail.length = Math.min(rocket.trail.length, 9);
        rocket.y -= rocket.speed * frameStep;
        rocket.speed *= Math.pow(.995, frameStep);
        rocket.trail.forEach((point, trailIndex) => {
          ctx.beginPath();
          ctx.globalAlpha = 1 - trailIndex / rocket.trail.length;
          ctx.fillStyle = rocket.color;
          ctx.shadowColor = rocket.color;
          ctx.shadowBlur = 12;
          ctx.arc(point.x, point.y, Math.max(1, 2.2 - trailIndex * .18), 0, Math.PI * 2);
          ctx.fill();
        });
        if (rocket.y <= rocket.target) {
          burst(rocket);
          rockets.splice(i, 1);
        }
      }
      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const spark = sparks[i];
        spark.trail.unshift({ x: spark.x, y: spark.y });
        spark.trail.length = Math.min(spark.trail.length, 5);
        spark.x += spark.vx * frameStep;
        spark.y += spark.vy * frameStep;
        const drag = Math.pow(.986, frameStep);
        spark.vx *= drag;
        spark.vy = spark.vy * drag + .036 * frameStep;
        spark.life -= .009 * frameStep;
        spark.trail.forEach((point, trailIndex) => {
          ctx.beginPath();
          ctx.globalAlpha = Math.max(0, spark.life) * (1 - trailIndex / spark.trail.length);
          ctx.fillStyle = spark.color;
          ctx.shadowColor = spark.color;
          ctx.shadowBlur = trailIndex === 0 ? 11 : 4;
          ctx.arc(point.x, point.y, Math.max(.35, spark.size - trailIndex * .22), 0, Math.PI * 2);
          ctx.fill();
        });
        if (spark.life <= 0) sparks.splice(i, 1);
      }
      ctx.globalAlpha = 1;
      if (nextLaunch === schedule.length && rockets.length === 0 && sparks.length === 0) {
        if (settledAt === null) settledAt = elapsed;
        if (elapsed - settledAt >= 650) {
          completeRef.current();
          return;
        }
      }
      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', resetFrameClock);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', resetFrameClock);
    };
  }, []);

  return <canvas className="fireworks-canvas" ref={canvasRef} aria-hidden="true" />;
}

function Countdown({ target }: { target: string }) {
  const [time, setTime] = useState(() => getCountdown(target));
  useEffect(() => {
    const timer = window.setInterval(() => setTime(getCountdown(target)), 1000);
    return () => window.clearInterval(timer);
  }, [target]);
  const units = [[time.days, 'DAYS'], [time.hours, 'HOURS'], [time.mins, 'MINS'], [time.secs, 'SECS']] as const;
  return (
    <div className="countdown" aria-label="生日倒计时">
      {units.map(([value, label]) => (
        <div className="time-cell" key={label}><strong>{String(value).padStart(2, '0')}</strong><span>{label}</span></div>
      ))}
    </div>
  );
}

export default function GiftExperience({ mode }: { mode: DisplayMode }) {
  const [config, setConfig] = useState(defaultGiftConfig);
  const [entered, setEntered] = useState(false);
  const [calibrationStep, setCalibrationStep] = useState<CalibrationStep>('sound');
  const [soundPassed, setSoundPassed] = useState(false);
  const [performancePassed, setPerformancePassed] = useState(false);
  const [quality, setQuality] = useState<'high' | 'balanced'>('high');
  const [gesturePass, setGesturePass] = useState<Record<GestureKey, boolean>>({ ...emptyGesturePass });
  const [cameraState, setCameraState] = useState<'off' | 'loading' | 'on' | 'error' | 'fallback'>('off');
  const [gestureLabel, setGestureLabel] = useState('等待连接');
  const [micState, setMicState] = useState<'off' | 'loading' | 'calibrating' | 'ready' | 'passed' | 'error' | 'fallback'>('off');
  const [micLevel, setMicLevel] = useState(0);
  const [stage, setStage] = useState<Stage>('countdown');
  const [launchNumber, setLaunchNumber] = useState(3);
  const [spread, setSpread] = useState(false);
  const [candleOut, setCandleOut] = useState(false);
  const [letterOpen, setLetterOpen] = useState(false);
  const [specialStarOpen, setSpecialStarOpen] = useState(false);
  const [specialStarDiscovering, setSpecialStarDiscovering] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [easterToast, setEasterToast] = useState('');

  const stageRef = useRef<Stage>('countdown');
  const enteredRef = useRef(false);
  const testVideoRef = useRef<HTMLVideoElement>(null);
  const dockVideoRef = useRef<HTMLVideoElement>(null);
  const trackingVideoRef = useRef<HTMLVideoElement>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<{ close: () => Promise<void> } | null>(null);
  const trackingRaf = useRef(0);
  const trackingTimeoutRef = useRef<number | null>(null);
  const trackingSessionRef = useRef(0);
  const trackerReadyRef = useRef(false);
  const trackingErrorsRef = useRef(0);
  const gestureHandlerRef = useRef<(name: GestureKey) => void>(() => undefined);
  const gesturePassRef = useRef<Record<GestureKey, boolean>>({ ...emptyGesturePass });
  const poseStabilityRef = useRef<{ candidate: GestureKey | null; frames: number; active: GestureKey | null; neutralFrames: number }>({ candidate: null, frames: 0, active: null, neutralFrames: 0 });
  const actionCooldownRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micRaf = useRef(0);
  const micPurpose = useRef<'test' | 'candle' | 'none'>('none');
  const baselineRef = useRef(.02);
  const blowStartedRef = useRef(0);
  const levelFrameRef = useRef(0);
  const specialStarTimer = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  const signatureClicks = useRef<number[]>([]);
  const ageHoldTimer = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setConfig(readQueryConfig()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => { stageRef.current = stage; }, [stage]);
  useEffect(() => { enteredRef.current = entered; }, [entered]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = stage === 'cake' ? .08 : .32;
  }, [config.musicUrl, stage]);

  useEffect(() => {
    if (!specialStarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSpecialStarOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [specialStarOpen]);

  const theme = useMemo(() => ({ '--accent': config.accent, '--cyan': config.cyan, '--pink': config.pink } as CSSProperties), [config]);

  const getAudioContext = useCallback(() => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContextRef.current) audioContextRef.current = new AudioContextClass();
    if (audioContextRef.current.state === 'suspended') audioContextRef.current.resume().catch(() => undefined);
    return audioContextRef.current;
  }, []);

  const playSfx = useCallback((kind: 'chime' | 'success' | 'whoosh' | 'firework' | 'paper') => {
    if (!soundEnabled) return;
    const context = getAudioContext();
    if (!context) return;
    const now = context.currentTime;
    if (kind === 'firework' || kind === 'whoosh' || kind === 'paper') {
      const length = Math.floor(context.sampleRate * (kind === 'firework' ? .34 : .24));
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, kind === 'paper' ? 2.8 : 1.6);
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      filter.type = kind === 'firework' ? 'lowpass' : 'bandpass';
      filter.frequency.value = kind === 'firework' ? 720 : kind === 'whoosh' ? 1200 : 2200;
      gain.gain.setValueAtTime(kind === 'firework' ? .055 : .035, now);
      gain.gain.exponentialRampToValueAtTime(.0001, now + (kind === 'firework' ? .34 : .24));
      source.buffer = buffer;
      source.connect(filter).connect(gain).connect(context.destination);
      source.start(now);
      return;
    }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(kind === 'chime' ? 520 : 660, now);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'chime' ? 780 : 990, now + .22);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.11, now + .02);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .42);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + .45);
  }, [getAudioContext, soundEnabled]);

  useEffect(() => {
    let frames = 0;
    const started = performance.now();
    let raf = 0;
    const measure = () => {
      frames += 1;
      if (performance.now() - started < 900) raf = requestAnimationFrame(measure);
      else {
        const fps = frames / ((performance.now() - started) / 1000);
        setQuality(fps >= 45 ? 'high' : 'balanced');
        setPerformancePassed(true);
      }
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, []);

  const enterCake = useCallback(() => {
    setCandleOut(false);
    micPurpose.current = micState === 'passed' || micState === 'ready' ? 'candle' : 'none';
    setStage('cake');
  }, [micState]);

  const openLetter = useCallback(() => {
    if (letterOpen) return;
    if (holdTimer.current) window.clearInterval(holdTimer.current);
    setHoldProgress(100);
    setLetterOpen(true);
    playSfx('paper');
    navigator.vibrate?.(24);
  }, [letterOpen, playSfx]);

  const startRitual = useCallback(() => {
    if (stageRef.current !== 'countdown') return;
    setStage('launch');
    setLaunchNumber(3);
    let number = 3;
    const timer = window.setInterval(() => {
      number -= 1;
      setLaunchNumber(number);
      playSfx(number > 0 ? 'chime' : 'success');
      if (number <= 0) {
        window.clearInterval(timer);
        window.setTimeout(() => {
          enterCake();
        }, 620);
      }
    }, 760);
  }, [enterCake, playSfx]);

  const completeSoundTest = () => {
    setSoundEnabled(true);
    playSfx('chime');
    setSoundPassed(true);
    window.setTimeout(() => setCalibrationStep('gestures'), 520);
  };

  const addGesturePass = useCallback((name: GestureKey) => {
    const now = Date.now();
    const label = gestureNames.find(item => item.key === name)?.label || '手势已识别';
    const newlyPassed = !gesturePassRef.current[name];
    if (newlyPassed) {
      gesturePassRef.current = { ...gesturePassRef.current, [name]: true };
      setGesturePass(gesturePassRef.current);
      setGestureLabel(`${label} · 识别成功`);
      playSfx('success');
      navigator.vibrate?.(18);
    } else setGestureLabel(`${label} · 已连接`);

    if (enteredRef.current && !specialStarOpen && !specialStarDiscovering && now >= actionCooldownRef.current) {
      const current = stageRef.current;
      let handled = false;
      if (name === 'openPalm') {
        if (current === 'countdown') { startRitual(); handled = true; }
        else if (current === 'final') { setSpread(value => !value); handled = true; }
      }
      if (name === 'fist' && current === 'letter') {
        if (letterOpen) setStage('final');
        else openLetter();
        handled = true;
      }
      if (handled) actionCooldownRef.current = now + 820;
    }
  }, [letterOpen, openLetter, playSfx, specialStarDiscovering, specialStarOpen, startRitual]);

  useEffect(() => {
    gestureHandlerRef.current = addGesturePass;
  }, [addGesturePass]);

  const stopGestureTracking = useCallback(() => {
    trackingSessionRef.current += 1;
    cancelAnimationFrame(trackingRaf.current);
    if (trackingTimeoutRef.current) window.clearTimeout(trackingTimeoutRef.current);
    trackingTimeoutRef.current = null;
    mediaRef.current?.getTracks().forEach(track => track.stop());
    mediaRef.current = null;
    if (trackingVideoRef.current) trackingVideoRef.current.srcObject = null;
    if (testVideoRef.current) testVideoRef.current.srcObject = null;
    if (dockVideoRef.current) dockVideoRef.current.srcObject = null;
    trackerRef.current?.close().catch(() => undefined);
    trackerRef.current = null;
    trackerReadyRef.current = false;
    trackingErrorsRef.current = 0;
  }, []);

  const activateGestureFallback = useCallback(() => {
    stopGestureTracking();
    gesturePassRef.current = { openPalm: true, fist: true };
    setCameraState('fallback');
    setGesturePass(gesturePassRef.current);
    setGestureLabel('已启用触控兼容模式');
    window.setTimeout(() => setCalibrationStep('microphone'), 420);
  }, [stopGestureTracking]);

  const startCamera = useCallback(async () => {
    if (cameraState === 'on' || cameraState === 'loading') return;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      activateGestureFallback();
      return;
    }
    setCameraState('loading');
    stopGestureTracking();
    const session = trackingSessionRef.current;
    poseStabilityRef.current = { candidate: null, frames: 0, active: null, neutralFrames: 0 };
    try {
      await loadScript(`${HANDS_ASSET_ROOT}/hands.js`);
      if (!window.Hands) throw new Error('gesture-runtime-not-ready');
      const hands = new window.Hands({ locateFile: file => `${HANDS_ASSET_ROOT}/${file}` });
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: window.innerWidth < 760 ? 0 : 1,
        minDetectionConfidence: .5,
        minTrackingConfidence: .45,
        useCpuInference: window.innerWidth < 760,
      });
      await hands.initialize();
      if (session !== trackingSessionRef.current) {
        await hands.close().catch(() => undefined);
        return;
      }
      trackerRef.current = hands;
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
      mediaRef.current = stream;
      const trackingVideo = trackingVideoRef.current;
      const previewVideo = testVideoRef.current;
      if (!trackingVideo) throw new Error('camera-not-ready');
      trackingVideo.srcObject = stream;
      if (previewVideo) previewVideo.srcObject = stream;
      await trackingVideo.play();
      if (previewVideo) await previewVideo.play().catch(() => undefined);
      hands.onResults(results => {
        if (session !== trackingSessionRef.current) return;
        trackingErrorsRef.current = 0;
        if (!trackerReadyRef.current) {
          trackerReadyRef.current = true;
          if (trackingTimeoutRef.current) window.clearTimeout(trackingTimeoutRef.current);
          trackingTimeoutRef.current = null;
          setCameraState('on');
          setGestureLabel('识别模型已就绪，请完成两种手势');
        }
        const points = results.multiHandLandmarks?.[0];
        const stability = poseStabilityRef.current;
        if (!points) {
          stability.neutralFrames += 1;
          stability.candidate = null;
          stability.frames = 0;
          if (stability.neutralFrames >= 5) stability.active = null;
          setGestureLabel('请把整只手放进取景框');
          return;
        }

        const pose = classifyHandPose(points);
        if (!pose) {
          stability.neutralFrames += 1;
          stability.candidate = null;
          stability.frames = 0;
          if (stability.neutralFrames >= 5) stability.active = null;
        } else {
          stability.neutralFrames = 0;
          if (stability.candidate === pose) stability.frames += 1;
          else { stability.candidate = pose; stability.frames = 1; }
          if (stability.frames >= 5 && stability.active !== pose) {
            stability.active = pose;
            gestureHandlerRef.current(pose);
          }
        }

      });
      let busy = false;
      const track = async () => {
        if (session !== trackingSessionRef.current) return;
        if (!busy && !document.hidden && trackingVideo.readyState >= 2) {
          busy = true;
          try {
            await hands.send({ image: trackingVideo });
            trackingErrorsRef.current = 0;
          } catch {
            trackingErrorsRef.current += 1;
            if (trackingErrorsRef.current >= 3) {
              stopGestureTracking();
              setCameraState('error');
              setGestureLabel('识别模型运行失败，请重试或使用触控模式');
              return;
            }
          }
          busy = false;
        }
        trackingRaf.current = requestAnimationFrame(track);
      };
      trackingTimeoutRef.current = window.setTimeout(() => {
        if (session === trackingSessionRef.current && !trackerReadyRef.current) {
          stopGestureTracking();
          setCameraState('error');
          setGestureLabel('识别模型启动超时，请重试或使用触控模式');
        }
      }, 9000);
      track();
    } catch {
      stopGestureTracking();
      setCameraState('error');
      setGestureLabel('摄像头或手势模型未能启动，请重试');
    }
  }, [activateGestureFallback, cameraState, stopGestureTracking]);

  useEffect(() => {
    const allPassed = Object.values(gesturePass).every(Boolean);
    if (cameraState === 'on' && allPassed && calibrationStep === 'gestures') {
      const timer = window.setTimeout(() => setCalibrationStep('microphone'), 650);
      return () => window.clearTimeout(timer);
    }
  }, [cameraState, calibrationStep, gesturePass]);

  const extinguishCandle = useCallback(() => {
    if (stageRef.current !== 'cake' || candleOut) return;
    setCandleOut(true);
    micPurpose.current = 'none';
    playSfx('whoosh');
    navigator.vibrate?.([20, 45, 20]);
    window.setTimeout(() => setStage('fireworks'), 720);
  }, [candleOut, playSfx]);

  const monitorMic = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const values = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(values);
      let energy = 0;
      for (let i = 0; i < values.length; i += 1) {
        const value = (values[i] - 128) / 128;
        energy += value * value;
      }
      const rms = Math.sqrt(energy / values.length);
      levelFrameRef.current += 1;
      if (levelFrameRef.current % 4 === 0) setMicLevel(Math.min(1, rms * 8.5));
      const threshold = Math.max(.055, baselineRef.current * 2.7);
      if (micPurpose.current !== 'none' && rms > threshold) {
        if (!blowStartedRef.current) blowStartedRef.current = performance.now();
        if (performance.now() - blowStartedRef.current > 430) {
          if (micPurpose.current === 'test') {
            micPurpose.current = 'none';
            setMicState('passed');
            playSfx('success');
            window.setTimeout(() => setCalibrationStep('ready'), 650);
          } else extinguishCandle();
          blowStartedRef.current = 0;
        }
      } else blowStartedRef.current = 0;
      micRaf.current = requestAnimationFrame(tick);
    };
    tick();
  }, [extinguishCandle, playSfx]);

  const activateMicFallback = useCallback(() => {
    micPurpose.current = 'none';
    micStreamRef.current?.getTracks().forEach(track => track.stop());
    micStreamRef.current = null;
    setMicState('fallback');
    window.setTimeout(() => setCalibrationStep('ready'), 420);
  }, []);

  const startMicTest = useCallback(async () => {
    if (micState === 'loading' || micState === 'calibrating' || micState === 'passed') return;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      activateMicFallback();
      return;
    }
    setMicState('loading');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      micStreamRef.current = stream;
      const context = getAudioContext();
      if (!context) {
        activateMicFallback();
        return;
      }
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
      setMicState('calibrating');
      const samples: number[] = [];
      const values = new Uint8Array(analyser.fftSize);
      const sample = () => {
        analyser.getByteTimeDomainData(values);
        let energy = 0;
        for (let i = 0; i < values.length; i += 1) { const value = (values[i] - 128) / 128; energy += value * value; }
        samples.push(Math.sqrt(energy / values.length));
      };
      const sampler = window.setInterval(sample, 70);
      window.setTimeout(() => {
        window.clearInterval(sampler);
        baselineRef.current = Math.max(.008, samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length));
        micPurpose.current = 'test';
        setMicState('ready');
        monitorMic();
      }, 1050);
    } catch {
      activateMicFallback();
    }
  }, [activateMicFallback, getAudioContext, micState, monitorMic]);

  useEffect(() => {
    if (entered && dockVideoRef.current && mediaRef.current) {
      dockVideoRef.current.srcObject = mediaRef.current;
      dockVideoRef.current.play().catch(() => undefined);
    }
  }, [entered]);

  useEffect(() => {
    const resumeTrackingVideo = () => {
      if (document.hidden || !mediaRef.current || !trackingVideoRef.current) return;
      trackingVideoRef.current.play().catch(() => undefined);
      dockVideoRef.current?.play().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', resumeTrackingVideo);
    window.addEventListener('pageshow', resumeTrackingVideo);
    return () => {
      document.removeEventListener('visibilitychange', resumeTrackingVideo);
      window.removeEventListener('pageshow', resumeTrackingVideo);
    };
  }, []);

  const enterExperience = async () => {
    // Start inside the click event so mobile autoplay policies retain user activation.
    if (soundEnabled && config.musicUrl && audioRef.current) audioRef.current.play().catch(() => undefined);
    try { await document.documentElement.requestFullscreen?.(); } catch { /* Immersive CSS remains active. */ }
    setEntered(true);
    setStage('countdown');
    playSfx('chime');
  };

  const beginLetterHold = () => {
    if (letterOpen) return;
    let progress = 0;
    setHoldProgress(0);
    holdTimer.current = window.setInterval(() => {
      progress += 5;
      setHoldProgress(progress);
      if (progress >= 100) openLetter();
    }, 55);
  };

  const cancelLetterHold = () => {
    if (letterOpen) return;
    if (holdTimer.current) window.clearInterval(holdTimer.current);
    setHoldProgress(0);
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (config.musicUrl && audioRef.current) {
      if (next) audioRef.current.play().catch(() => undefined);
      else audioRef.current.pause();
    }
  };

  const onPointerDown = () => {
    if (entered && soundEnabled && audioRef.current?.paused && !audioRef.current.error) {
      audioRef.current.play().catch(() => undefined);
    }
  };

  const discoverSpecialStar = () => {
    if (specialStarDiscovering || specialStarOpen) return;
    setSpecialStarDiscovering(true);
    playSfx('success');
    navigator.vibrate?.(18);
    specialStarTimer.current = window.setTimeout(() => {
      setSpecialStarOpen(true);
      setSpecialStarDiscovering(false);
      specialStarTimer.current = null;
    }, 280);
  };

  const revealAgeEgg = () => {
    ageHoldTimer.current = window.setTimeout(() => {
      if (config.metDate) {
        const days = Math.max(1, Math.floor((Date.now() - new Date(config.metDate).getTime()) / 86_400_000));
        setEasterToast(`这束信号已经连接了 ${days} 天`);
      } else setEasterToast('快乐没有期限，友谊也没有。');
      playSfx('success');
    }, 850);
  };

  const cancelAgeEgg = () => { if (ageHoldTimer.current) window.clearTimeout(ageHoldTimer.current); };

  const signatureSecret = () => {
    const now = Date.now();
    signatureClicks.current = [...signatureClicks.current.filter(time => now - time < 1300), now];
    if (signatureClicks.current.length >= 3) {
      signatureClicks.current = [];
      setLetterOpen(true);
      setStage('letter');
      setEasterToast('你找到了听听藏起来的另一条入口。');
      playSfx('success');
    }
  };

  useEffect(() => {
    if (!easterToast) return;
    const timer = window.setTimeout(() => setEasterToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [easterToast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!enteredRef.current || specialStarOpen || specialStarDiscovering) return;
      if (event.key === 'Enter' && stageRef.current === 'countdown') startRitual();
      if (event.key === 'Enter' && stageRef.current === 'letter') openLetter();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openLetter, specialStarDiscovering, specialStarOpen, startRitual]);

  useEffect(() => () => {
    stopGestureTracking();
    cancelAnimationFrame(micRaf.current);
    micStreamRef.current?.getTracks().forEach(track => track.stop());
    if (specialStarTimer.current) window.clearTimeout(specialStarTimer.current);
    if (holdTimer.current) window.clearInterval(holdTimer.current);
  }, [stopGestureTracking]);

  const calibrationComplete = soundPassed && performancePassed && Object.values(gesturePass).every(Boolean) && ['passed', 'fallback'].includes(micState);
  const gesturePassedCount = Object.values(gesturePass).filter(Boolean).length;
  const nextGesture = gestureNames.find(item => !gesturePass[item.key]) || gestureNames[gestureNames.length - 1];
  const gestureCoach = '把整只手放在中央，稳定保持约半秒';
  const stageLabel = stage === 'countdown' ? 'WAITING' : stage === 'launch' ? 'IGNITION' : stage === 'cake' ? 'CAKE PROTOCOL' : stage === 'fireworks' ? 'FIREWORKS' : stage === 'letter' ? 'SEALED LETTER' : 'WISH COMPLETE';

  return (
    <main className={`gift-shell mode-${mode} ${entered ? `stage-${stage}` : 'stage-calibration'}`} style={theme} onPointerDown={onPointerDown}>
      <ParticleWorld stage={stage} spread={spread} quality={quality} accent={config.accent} cyan={config.cyan} pink={config.pink} />
      <div className="space-haze" aria-hidden="true" />
      <div className="scanlines" aria-hidden="true" />

      {!entered ? (
        <section className="calibration-shell" aria-label="设备测试">
          <header className="calibration-header">
            <span className="signal"><i /> GIFT SIGNAL CALIBRATION</span>
            <span>测试不会提前展示正式惊喜</span>
          </header>
          <div className="calibration-progress" aria-label="测试进度">
            {(['sound', 'gestures', 'microphone', 'ready'] as CalibrationStep[]).map((item, index) => (
              <div key={item} className={calibrationStep === item ? 'current' : ['sound', 'gestures', 'microphone', 'ready'].indexOf(calibrationStep) > index ? 'done' : ''}>
                <span>0{index + 1}</span><i />
              </div>
            ))}
          </div>

          <div className="calibration-card">
            {calibrationStep === 'sound' && (
              <div className="test-step sound-test">
                <p className="eyebrow">STEP 01 · SOUND CHECK</p>
                <div className="test-glyph sound-glyph"><span>♫</span><i /><i /></div>
                <h1>先确认声音。</h1>
                <p>点击按钮会播放一声很轻的提示音。后面的烟花、吹气和信封都有细小的声音反馈。</p>
                <button className="ignite test-action" type="button" onClick={completeSoundTest}><span>播放测试音</span><b>→</b></button>
              </div>
            )}

            {calibrationStep === 'gestures' && (
              <div className="test-step gesture-test">
                <div className="test-copy">
                  <p className="eyebrow">STEP 02 · GESTURE CHECK</p>
                  <h1>跟着提示，逐个完成手势。</h1>
                  <p>一次只做一个动作。摄像头画面仅在设备本地识别，不会录制或上传。</p>
                  <div className="gesture-coach" aria-live="polite">
                    <small>NEXT · {String(Math.min(gesturePassedCount + 1, gestureNames.length)).padStart(2, '0')} / {String(gestureNames.length).padStart(2, '0')}</small>
                    <i>{gesturePassedCount === gestureNames.length ? '✓' : nextGesture.glyph}</i><strong>{gesturePassedCount === gestureNames.length ? '两种手势全部通过' : nextGesture.label}</strong>
                    <span>{gesturePassedCount === gestureNames.length ? '正在进入下一项测试…' : gestureCoach}</span>
                  </div>
                  <div className="gesture-checklist">
                    {gestureNames.map(item => <div key={item.key} className={gesturePass[item.key] ? 'passed' : nextGesture.key === item.key ? 'current' : ''}><i>{gesturePass[item.key] ? '✓' : item.glyph}</i><span>{item.label}</span><b>{gesturePass[item.key] ? '通过' : nextGesture.key === item.key ? '请做' : '等待'}</b></div>)}
                  </div>
                  {cameraState !== 'loading' ? <button className="fallback-link" type="button" onClick={activateGestureFallback}>{cameraState === 'on' ? '识别仍不顺？改用触控兼容模式' : '内置浏览器不支持？改用触控兼容模式'}</button> : null}
                </div>
                <div className={`test-camera camera-${cameraState}`}>
                  <video ref={testVideoRef} muted playsInline aria-label="手势测试摄像头画面" />
                  <div className="camera-reticle"><i /><i /><i /><i /></div>
                  <span>{gestureLabel}</span>
                  {cameraState !== 'on' && <button type="button" onClick={startCamera} disabled={cameraState === 'loading'}>{cameraState === 'loading' ? '正在连接…' : '连接摄像头'}</button>}
                </div>
              </div>
            )}

            {calibrationStep === 'microphone' && (
              <div className="test-step microphone-test">
                <p className="eyebrow">STEP 03 · BREATH CHECK</p>
                <div className={`test-candle mic-${micState}`} style={{ '--mic-level': micLevel } as CSSProperties}>
                  <div className="test-flame" /><div className="test-wick" />
                  <span className="sound-ring ring-a" /><span className="sound-ring ring-b" />
                </div>
                <h1>{micState === 'passed' ? '吹气识别成功。' : '测试一次轻轻的吹气。'}</h1>
                <p>{micState === 'calibrating' ? '请保持安静，正在检测环境声音…' : micState === 'ready' ? '现在对着设备持续轻轻吹气约半秒。' : micState === 'passed' ? '正式蜡烛会使用同样的方式熄灭。' : '这里使用的是测试蜡烛，不会提前触发烟花。'}</p>
                {micState === 'off' || micState === 'error' ? <button className="ignite test-action" type="button" onClick={startMicTest}><span>{micState === 'error' ? '重新连接麦克风' : '连接麦克风'}</span><b>→</b></button> : null}
                {!['loading', 'calibrating', 'passed', 'fallback'].includes(micState) ? <button className="fallback-link" type="button" onClick={activateMicFallback}>内置浏览器不支持？改用按钮兼容模式</button> : null}
              </div>
            )}

            {calibrationStep === 'ready' && (
              <div className="test-step ready-test">
                <p className="eyebrow">CALIBRATION COMPLETE</p>
                <div className="ready-orbit"><strong>✓</strong><i /><i /></div>
                <h1>一切准备好了。</h1>
                <div className="ready-grid">
                  <span><i>✓</i> 声音正常</span><span><i>✓</i> {cameraState === 'fallback' ? '触控备用' : '手势连接'}</span>
                  <span><i>✓</i> {micState === 'fallback' ? '按钮备用' : '吹气识别'}</span><span><i>✓</i> {quality === 'high' ? '高质量粒子' : '流畅粒子'}</span>
                </div>
                <button className="ignite enter-gift" type="button" disabled={!calibrationComplete} onClick={enterExperience}><span>全屏进入礼物</span><b>↗</b></button>
                <p className="privacy-note">摄像头与麦克风数据仅在当前设备处理</p>
              </div>
            )}
          </div>
          <footer className="calibration-footer"><span>PRIVATE DEVICE CHECK</span><strong>{config.signature}</strong></footer>
        </section>
      ) : (
        <>
          <header className="hud-top">
            <span className="signal"><i /> BIRTHDAY SIGNAL</span>
            <nav aria-label="版本入口"><a href={`${BASE_PATH}/desktop/`}>DESKTOP</a><span>/</span><a href={`${BASE_PATH}/mobile/`}>MOBILE</a></nav>
            <span className="edition">A SPECIAL BIRTHDAY GIFT</span>
          </header>

          <section className={`scene scene-countdown ${stage === 'countdown' ? 'active' : ''}`} aria-hidden={stage !== 'countdown'}>
            <div className="hero-copy">
              <p className="eyebrow">A PRIVATE UNIVERSE FOR</p>
              <h1><span>致{config.friendName}</span><em>HAPPY BIRTHDAY</em></h1>
              <p className="intro">{config.greeting}</p>
              <Countdown target={config.targetDate} />
              <button className="ignite" type="button" onClick={startRitual}><span>开启生日仪式</span><b>→</b></button>
              <p className="micro-hint">{cameraState === 'on' ? 'ENTER / 张开手掌开启' : 'ENTER / 轻触按钮开启'}</p>
            </div>
            <button className="orb-label" type="button" onPointerDown={revealAgeEgg} onPointerUp={cancelAgeEgg} onPointerLeave={cancelAgeEgg} aria-label={`${config.age}岁生日，长按发现彩蛋`}><small>AGE</small><strong>{config.age || '∞'}<em>岁</em></strong><span>LONG PRESS</span></button>
          </section>

          <section className={`scene launch-scene ${stage === 'launch' ? 'active' : ''}`} aria-hidden={stage !== 'launch'}>
            <p>SYSTEM AWAKENING</p><strong>{launchNumber > 0 ? launchNumber : 'GO'}</strong><span>正在重组星光坐标</span>
          </section>

          <section className={`scene cake-scene ${stage === 'cake' ? 'active' : ''} ${candleOut ? 'candle-out' : ''}`} aria-hidden={stage !== 'cake'}>
            <div className="cake-copy">
              <p className="eyebrow">CAKE PROTOCOL · {candleOut ? 'WISH RECEIVED' : 'MIC READY'}</p>
              <h2>{candleOut ? '愿望已经收到。' : '许一个愿望吧。'}</h2>
              <p>{micState === 'passed' ? '想好以后，对着蜡烛持续轻轻吹气。' : '愿望不必告诉任何人，星星会负责替你保密。'}</p>
              <div className="breath-meter" style={{ '--mic-level': micLevel } as CSSProperties}><i /><span>{!candleOut && (micState === 'passed' || micState === 'ready') ? '正在听你的吹气…' : candleOut ? '蜡烛已熄灭' : '麦克风备用模式'}</span></div>
              {!candleOut ? <button className={`ignite compact ${micState === 'passed' || micState === 'ready' ? 'compat-action' : ''}`} type="button" onClick={extinguishCandle}><span>{micState === 'passed' || micState === 'ready' ? '收音不灵？轻触吹灭' : '吹灭蜡烛'}</span><b>✦</b></button> : null}
            </div>
            <div className="holo-cake" aria-label="粒子生日蛋糕">
              <div className="flame" /><div className="smoke-thread"><i /><i /><i /></div><div className="candle" />
              <div className="cake-tier tier-top" /><div className="cake-tier tier-middle" /><div className="cake-tier tier-bottom" />
              <div className="cake-ring" /><div className="cake-ring ring-two" />
            </div>
          </section>

          <section className={`scene fireworks-scene ${stage === 'fireworks' ? 'active' : ''}`} aria-hidden={stage !== 'fireworks'}>
            {stage === 'fireworks' && <FireworksCanvas onBurst={() => playSfx('firework')} onComplete={() => setStage('letter')} />}
            <div className="firework-copy"><p>愿望已经升空</p><span>烟花结束后，还有一封信等你打开。</span></div>
          </section>

          <section className={`scene letter-scene ${stage === 'letter' ? 'active' : ''} ${letterOpen ? 'letter-open' : ''}`} aria-hidden={stage !== 'letter'}>
            <div className="letter-intro"><p className="eyebrow">A SEALED LETTER FROM TINGTING</p><h2>{letterOpen ? '见字如面。' : '烟花结束了，听听还有一些话想告诉你。'}</h2></div>
            <div className="envelope-stage">
              <div className="envelope-back" />
              <div className="letter-paper" role="region" aria-label="生日祝福信件" tabIndex={letterOpen ? 0 : -1}>
                <p className="letter-to">To：{config.friendName}</p>
                {config.letter.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
                <strong>{config.signature}</strong>
                <button type="button" onClick={() => setStage('final')}>收下这份祝福 →</button>
              </div>
              <div className="envelope-front"><i /><i /></div>
              <button className="wax-seal" type="button" onPointerDown={beginLetterHold} onPointerUp={cancelLetterHold} onPointerLeave={cancelLetterHold} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') openLetter(); }} style={{ '--hold': `${holdProgress}%` } as CSSProperties} aria-label="长按打开信封"><span>听</span></button>
            </div>
            {!letterOpen && <div className="hold-hint"><span>长按封印，亲自打开</span><button type="button" onPointerDown={event => { event.stopPropagation(); openLetter(); }} onClick={openLetter}>无法长按？轻触打开</button></div>}
          </section>

          <section className={`scene final-scene ${stage === 'final' ? 'active' : ''}`} aria-hidden={stage !== 'final'}>
            <p className="eyebrow">WISH TRANSMISSION · COMPLETE</p><h2>生日快乐，<span className="friend-name">{config.friendName}。</span></h2><p>{config.message}</p>
            <button className="signature-secret" type="button" onClick={signatureSecret}>{config.signature}</button>
            <div className="final-actions"><button type="button" onClick={() => setSpread(value => !value)}>{spread ? '收拢烟花' : '绽放烟花'}</button><button type="button" onClick={() => { setStage('countdown'); setLetterOpen(false); setCandleOut(false); }}>再次观看</button></div>
            <p className="special-star-hint">试着轻触右上方那颗更亮的星星。</p>
          </section>

          {!['launch', 'fireworks', 'letter'].includes(stage) && (
            <>
              <button
                className={`special-star ${stage === 'final' ? 'is-inviting' : ''} ${specialStarDiscovering ? 'is-discovering' : ''}`}
                type="button"
                aria-label={`发现${config.specialStar.name}`}
                onClick={discoverSpecialStar}
              ><i /><span className="special-star-glyph">✦</span><span className="special-star-label">{config.specialStar.name}</span></button>
              <button className="shooting-star" type="button" aria-label="捕捉流星" onClick={() => { setEasterToast(easterBlessings[Math.floor(Math.random() * easterBlessings.length)]); playSfx('success'); }}><i /></button>
            </>
          )}

          {specialStarOpen && (
            <div className="special-star-modal" role="dialog" aria-modal="true" aria-labelledby="special-star-title" onClick={event => { if (event.target === event.currentTarget) setSpecialStarOpen(false); }}>
              <article>
                <button className="special-star-close" type="button" aria-label="关闭隐藏寄语" onClick={() => setSpecialStarOpen(false)}>×</button>
                <div className="special-star-mark" aria-hidden="true"><i /><span>✦</span></div>
                <p className="eyebrow">A HIDDEN STAR · FOUND</p>
                <h2 id="special-star-title">{config.specialStar.name}</h2>
                <div className="special-star-message">
                  {config.specialStar.message.map((paragraph, index) => (
                    <p className={index === config.specialStar.message.length - 1 ? 'special-star-wish' : ''} key={index}>{paragraph}</p>
                  ))}
                </div>
              </article>
            </div>
          )}

          {cameraState === 'on' && <aside className="gesture-dock"><video ref={dockVideoRef} muted playsInline aria-label="手势识别摄像头画面" /><div className="gesture-status"><i className="online" /><span>{gestureLabel}</span></div><p>张手开启 / 绽放烟花<br />握拳打开信件 / 收下祝福</p></aside>}
          <aside className="stage-rail" aria-label="仪式进度">{['countdown', 'cake', 'final'].map((item, index) => <div key={item} className={stage === item || (stage === 'launch' && item === 'countdown') || (['fireworks', 'letter'].includes(stage) && item === 'final') ? 'current' : ''}><span>0{index + 1}</span><i /></div>)}</aside>
          <div className="mobile-gesture-bar"><span>{stage === 'letter' ? letterOpen ? '阅读这封生日祝福' : cameraState === 'on' ? '握拳或长按，打开信件' : '长按封印，打开信件' : stage === 'cake' ? '对着蜡烛轻轻吹气' : cameraState === 'on' ? '◉ 手势已连接' : '◌ 触控模式'}</span><b>{stage === 'letter' ? letterOpen ? cameraState === 'on' ? '握拳或轻触收下祝福' : '滑动信纸 · 收下祝福' : '也可轻触打开' : stage === 'cake' ? micState === 'fallback' ? '也可轻触吹灭' : '麦克风已就绪' : stage === 'final' ? cameraState === 'on' ? '张手绽放烟花' : '轻触绽放烟花' : cameraState === 'on' ? '张手开启' : '轻触按钮开启'}</b></div>
          <footer className="hud-footer"><button type="button" className="sound-button" onClick={toggleSound}>{soundEnabled ? '♫ SOUND ON' : '♪ SOUND OFF'}</button><span className="stage-readout">{stageLabel}</span><button type="button" className="footer-signature" onClick={signatureSecret}>{config.signature}</button></footer>
          {easterToast && <div className="easter-toast" role="status"><i>✦</i><span>{easterToast}</span></div>}
        </>
      )}
      {config.musicUrl ? <audio ref={audioRef} src={withBasePath(config.musicUrl)} loop preload="metadata" onError={() => setEasterToast('背景音乐暂时无法加载，礼物仍可继续。')} /> : null}
      <video ref={trackingVideoRef} className="tracking-video-source" muted playsInline aria-hidden="true" />
    </main>
  );
}
