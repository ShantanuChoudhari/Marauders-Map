import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, ZoomControl, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { io, Socket } from "socket.io-client";
import {
  Activity, ArrowUpRight, Award, Book, Check, Compass, Crown, Eye, EyeOff,
  Flag, LocateFixed, LogOut, Menu, Radio, Route, Search,
  ShieldCheck, Sparkles, Star, Trophy, UserMinus, UserPlus, Users,
  Wifi, X, Zap, Package, ChevronRight, ChevronDown,
} from "lucide-react";
import {
  AchievementSummary, ArtifactSummary, ClientToServerEvents, Collectible,
  distanceMeters, FactionType, FriendProfile, FriendRequestSummary, GameEventFeedItem,
  GoldenSnitch, LeaderboardEntry, Mission, PlayerStatus, Position, PublicPlayer,
  QuestSummary, RoomSummary, RuneTrap, ServerToClientEvents, SharedDestination,
  SpellType, Spire, UserProgression, Visibility, XpGrant,
} from "@wayfinder/protocol";

type Player = { id: string; username: string; avatar: string; score: number };
type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const API = import.meta.env.VITE_API_URL ?? "/api";
const WS = import.meta.env.VITE_WS_URL ?? window.location.origin;
const DEFAULT: Position = { lat: Number(import.meta.env.VITE_MAP_CENTER_LAT ?? 18.5204), lng: Number(import.meta.env.VITE_MAP_CENTER_LNG ?? 73.8567) };
const avatars = ["🦁", "🐍", "🦅", "🦡", "🦉", "🪄", "🌙", "⚔️"];

const HOUSE_DATA: Record<string, {
  name: string;
  emoji: string;
  motto: string;
  title: string;
  patronus: string;
  themeColor: string;
  goldColor: string;
}> = {
  gryffindor: {
    name: "Gryffindor",
    emoji: "🦁",
    motto: "“Fortitudo et Virtus”",
    title: "Lionheart Prefect",
    patronus: "Silver Stag",
    themeColor: "#740001",
    goldColor: "#d3a625",
  },
  slytherin: {
    name: "Slytherin",
    emoji: "🐍",
    motto: "“Ambitio et Astutia”",
    title: "Serpent Shadowcaster",
    patronus: "Horned Serpent",
    themeColor: "#1a472a",
    goldColor: "#aaaaaa",
  },
  ravenclaw: {
    name: "Ravenclaw",
    emoji: "🦅",
    motto: "“Sapientia et Ingenium”",
    title: "Eagle Astronomer",
    patronus: "Silver Falcon",
    themeColor: "#0e1a40",
    goldColor: "#946b2d",
  },
  hufflepuff: {
    name: "Hufflepuff",
    emoji: "🦡",
    motto: "“Fidelitas et Constantia”",
    title: "Badger Herbologist",
    patronus: "Silver Badger",
    themeColor: "#ecb939",
    goldColor: "#372e29",
  },
  phoenix: {
    name: "Order of Phoenix",
    emoji: "🔥",
    motto: "“Resurrectio et Flamma”",
    title: "Phoenix Auror",
    patronus: "Golden Phoenix",
    themeColor: "#b91c1c",
    goldColor: "#fbbf24",
  },
  serpent: {
    name: "Slytherin",
    emoji: "🐍",
    motto: "“Ambitio et Astutia”",
    title: "Serpent Shadowcaster",
    patronus: "Horned Serpent",
    themeColor: "#1a472a",
    goldColor: "#aaaaaa",
  },
  owl: {
    name: "Ravenclaw",
    emoji: "🦉",
    motto: "“Sapientia et Ingenium”",
    title: "Eagle Astronomer",
    patronus: "Silver Falcon",
    themeColor: "#0e1a40",
    goldColor: "#946b2d",
  },
};

async function apiFetch(url: string, opts?: RequestInit) {
  const response = await fetch(url, opts);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) throw new Error("The Wayfinder server is unavailable. Start the local game services and try again.");
  try { return await response.json(); } catch { throw new Error("The Wayfinder server returned an incomplete response."); }
}

// ── Map icons ──────────────────────────────────────────────────
function avatarIcon(avatar: string, mine = false) {
  return L.divIcon({ className: "avatar-marker", html: `<div class="marker-bubble${mine ? " marker-me" : ""}"><span>${avatar}</span><i></i></div>`, iconSize: [42, 52], iconAnchor: [21, 48], popupAnchor: [0, -46] });
}
function itemIcon(relic: boolean) { return L.divIcon({ className: "item-marker", html: `<div class="item-pin ${relic ? "item-relic" : ""}"><span>${relic ? "✦" : "✳"}</span></div>`, iconSize: [32, 32], iconAnchor: [16, 16] }); }
function footprintIcon(index: number, name?: string, isLatest = false) {
  const isLeft = index % 2 === 0;
  const shoeSvg = `
    <svg class="marauder-foot ${isLeft ? 'foot-left' : 'foot-right'}" viewBox="0 0 28 42" width="20" height="30">
      <path d="${isLeft ? 'M14 2 C8 2 4 7 4 14 C4 20 8 23 13 23 C18 23 21 19 21 13 C21 6 18 2 14 2 Z' : 'M14 2 C10 2 7 6 7 13 C7 19 10 23 15 23 C20 23 24 20 24 14 C24 7 20 2 14 2 Z'}" fill="#2e1b0c" opacity="0.92" />
      <path d="${isLeft ? 'M14 28 C9 28 6 31 6 36 C6 40 9 41 14 41 C19 41 21 40 21 36 C21 31 18 28 14 28 Z' : 'M14 28 C10 28 7 31 7 36 C7 40 9 41 14 41 C19 41 22 40 22 36 C22 31 19 28 14 28 Z'}" fill="#2e1b0c" opacity="0.92" />
    </svg>
  `;
  const ribbonHtml = isLatest && name ? `<div class="footprint-name-ribbon"><span>${name}</span></div>` : "";
  return L.divIcon({
    className: "marauder-footprint-marker",
    html: `<div class="footprint-pair-wrap" style="--foot-delay:${-index * 0.22}s;--foot-rotation:${-18 + index * 7}deg">${ribbonHtml}${shoeSvg}</div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22]
  });
}
function spireIcon(faction: string) {
  const emoji = faction === "gryffindor" ? "🦁"
    : faction === "slytherin" ? "🐍"
    : faction === "ravenclaw" ? "🦅"
    : faction === "hufflepuff" ? "🦡"
    : faction === "phoenix" ? "🪶"
    : faction === "serpent" ? "🐍"
    : faction === "owl" ? "🦉"
    : "🏰";
  return L.divIcon({ className: `spire-marker spire-${faction}`, html: `<div class="spire-pin"><span>${emoji}</span><div class="spire-pulse"></div></div>`, iconSize: [46, 46], iconAnchor: [23, 23] });
}
function snitchIcon() {
  return L.divIcon({ className: "snitch-marker", html: `<div class="snitch-pin"><span class="snitch-orb">⚚</span><i class="snitch-wings"></i></div>`, iconSize: [38, 38], iconAnchor: [19, 19] });
}
function trapIcon(mine: boolean) {
  return L.divIcon({ className: `trap-marker ${mine ? "trap-mine" : "trap-enemy"}`, html: `<div class="trap-pin"><span>⚡</span></div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
}
function crownIcon() {
  return L.divIcon({ className: "crown-marker", html: `<div class="crown-pin"><span>👑</span></div>`, iconSize: [36, 36], iconAnchor: [18, 42] });
}
function dementorIcon() {
  return L.divIcon({ className: "dementor-marker", html: `<div class="dementor-pin"><span>👻</span><div class="dementor-fog"></div></div>`, iconSize: [42, 42], iconAnchor: [21, 21] });
}
function boggartIcon() {
  return L.divIcon({ className: "boggart-marker", html: `<div class="boggart-pin"><span>📦</span></div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
}
function frogIcon() {
  return L.divIcon({ className: "frog-marker", html: `<div class="frog-pin"><span>🐸</span></div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
}

const FROG_CARDS = [
  { id: "dumbledore", name: "Albus Dumbledore", era: "Order of Merlin, 1st Class", blurb: "Defeater of Grindelwald and Headmaster of Hogwarts. Known for discovering the 12 uses of dragon's blood.", emoji: "🧙‍♂️" },
  { id: "gryffindor", name: "Godric Gryffindor", era: "Hogwarts Co-Founder (c. 990)", blurb: "Duelist supreme, creator of the Sorting Hat, and champion of Muggle-born witches and wizards.", emoji: "🦁" },
  { id: "slytherin", name: "Salazar Slytherin", era: "Hogwarts Co-Founder (c. 990)", blurb: "Master of Parseltongue and skilled Legilimens. Builder of the legendary Chamber of Secrets.", emoji: "🐍" },
  { id: "ravenclaw", name: "Rowena Ravenclaw", era: "Hogwarts Co-Founder (c. 990)", blurb: "Wisest witch of her age. Designer of the ever-shifting Hogwarts floorplan and the lost Diadem.", emoji: "🦅" },
  { id: "hufflepuff", name: "Helga Hufflepuff", era: "Hogwarts Co-Founder (c. 990)", blurb: "Greatest cook of her era. Welcomed all students with warmth, loyalty, and unwavering dedication.", emoji: "🦡" },
  { id: "merlin", name: "Merlin the Enchanter", era: "Court of King Arthur", blurb: "Most famous wizard in history. Founder of the Order of Merlin, champion of Muggle rights.", emoji: "✨" },
  { id: "flamel", name: "Nicolas Flamel", era: "Alchemist (1327–1992)", blurb: "The only known creator of the Philosopher's Stone, turning metals into gold and granting immortality.", emoji: "💎" },
  { id: "potter", name: "Harry Potter", era: "The Boy Who Lived", blurb: "Seeker of Gryffindor, vanquisher of Lord Voldemort, and Master of Death through the Deathly Hallows.", emoji: "⚡" },
  { id: "scamander", name: "Newt Scamander", era: "Magizoologist", blurb: "Author of Fantastic Beasts and Where to Find Them. Companion of Bowtruckles and Nifflers.", emoji: "🦔" },
  { id: "snape", name: "Severus Snape", era: "Potions Master & Headmaster", blurb: "Master of Occlumency, creator of Sectumsempra, and bravest man Harry Potter ever knew.", emoji: "🧪" },
];

const POTION_RECIPES = [
  { id: "felix", name: "Felix Felicis (Liquid Luck)", ingredients: "Ashwinder Egg & Squill Bulb", duration: "60s", effect: "2x XP on all actions + Golden Footsteps", emoji: "🌟" },
  { id: "pepperup", name: "Pepperup Potion", ingredients: "Bicorn Horn & Mandrake Root", duration: "45s", effect: "Super Broomstick Flight Speed (3.5x)", emoji: "⚡" },
  { id: "polyjuice", name: "Polyjuice Potion", ingredients: "Boomslang Skin & Lacewing Flies", duration: "90s", effect: "Mysterious Wizard Disguise", emoji: "🎭" },
];

const SORTING_QUESTIONS = [
  {
    question: "When entering the Forbidden Forest at midnight, which path do you choose?",
    options: [
      { text: "The perilous gorge where dangerous beasts howl — courage leads the way.", house: "gryffindor" as FactionType },
      { text: "The secret shadowed tunnel giving an unseen advantage over any rival.", house: "slytherin" as FactionType },
      { text: "The ancient stone bridge etched with glowing celestial runes.", house: "ravenclaw" as FactionType },
      { text: "The friendly trail leading to a wounded creature in need of shelter.", house: "hufflepuff" as FactionType },
    ],
  },
  {
    question: "Which magical artifact would you most covet from the Hogwarts vaults?",
    options: [
      { text: "The Sword of Gryffindor, forged by goblins and imbued with basilisk venom.", house: "gryffindor" as FactionType },
      { text: "Salazar Slytherin's Locket, whispering ancient secrets of supreme power.", house: "slytherin" as FactionType },
      { text: "Rowena Ravenclaw's Diadem, bestowing boundless wit and cosmic knowledge.", house: "ravenclaw" as FactionType },
      { text: "Helga Hufflepuff's Golden Cup, radiating boundless kinship and healing warmth.", house: "hufflepuff" as FactionType },
    ],
  },
];

type AudioChimeType =
  | "click"
  | "lumos"
  | "cloak"
  | "trap"
  | "ping"
  | "snitch"
  | "spire"
  | "solemn"
  | "mischief"
  | "patronus"
  | "expelliarmus"
  | "alohomora"
  | "dementor"
  | "broom"
  | "potion"
  | "riddikulus"
  | "cooldown"
  | "protego"
  | "stupefy"
  | "incendio"
  | "clash"
  | "duel_win";

let sharedAudioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === "suspended") {
      void sharedAudioCtx.resume();
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

function playAudioChime(type: AudioChimeType) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (type === "click") {
      // Crisp resonant magical button click / wand tap
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc1.type = "sine";
      osc2.type = "triangle";
      osc1.frequency.setValueAtTime(659.25, now);
      osc1.frequency.exponentialRampToValueAtTime(1318.5, now + 0.08);
      osc2.frequency.setValueAtTime(220, now);
      osc2.frequency.exponentialRampToValueAtTime(110, now + 0.06);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start(now); osc1.stop(now + 0.1);
      osc2.start(now); osc2.stop(now + 0.1);
    } else if (type === "ping") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.18);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.35);
    } else if (type === "cooldown") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.1);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.12);
    } else if (type === "solemn") {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc1.type = "triangle";
      osc2.type = "sine";
      osc1.frequency.setValueAtTime(1400, now);
      osc1.frequency.exponentialRampToValueAtTime(1900, now + 0.12);
      osc2.frequency.setValueAtTime(493.88, now + 0.08);
      osc2.frequency.setValueAtTime(739.99, now + 0.35);
      osc2.frequency.exponentialRampToValueAtTime(987.77, now + 0.7);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.22, now + 0.4);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start(now); osc1.stop(now + 0.25);
      osc2.start(now + 0.08); osc2.stop(now + 1.1);
    } else if (type === "mischief") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(987.77, now);
      osc.frequency.setValueAtTime(830.61, now + 0.18);
      osc.frequency.setValueAtTime(659.25, now + 0.36);
      osc.frequency.setValueAtTime(493.88, now + 0.54);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.95);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 1.05);
    } else if (type === "lumos") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.exponentialRampToValueAtTime(1046.5, now + 0.35);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.45);
    } else if (type === "snitch") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1318.5, now + 0.15);
      osc.frequency.setValueAtTime(1760, now + 0.3);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.6);
    } else if (type === "trap") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.3);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.32);
    } else if (type === "cloak") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(380, now);
      osc.frequency.exponentialRampToValueAtTime(190, now + 0.4);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.42);
    } else if (type === "spire") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.35);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.45);
    } else if (type === "patronus") {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + i * 0.12);
        gain.gain.setValueAtTime(0.001, now + i * 0.12);
        gain.gain.linearRampToValueAtTime(0.12, now + i * 0.12 + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 1.2);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + i * 0.12); osc.stop(now + i * 0.12 + 1.2);
      });
    } else if (type === "expelliarmus") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(1800, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.28);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.3);
    } else if (type === "alohomora") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.setValueAtTime(1200, now + 0.08);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.35);
    } else if (type === "dementor") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(85, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 1.2);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.3);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 1.3);
    } else if (type === "broom") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(580, now + 0.4);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.5);
    } else if (type === "potion") {
      [420, 560, 480].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + idx * 0.1);
        gain.gain.setValueAtTime(0.1, now + idx * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.2);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + idx * 0.1); osc.stop(now + idx * 0.1 + 0.2);
      });
    } else if (type === "riddikulus") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.linearRampToValueAtTime(820, now + 0.2);
      osc.frequency.exponentialRampToValueAtTime(200, now + 0.45);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.5);
    } else if (type === "protego") {
      // Shimmering crystalline shield harmonic
      [587.33, 880, 1174.66, 1760].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + i * 0.04);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.12, now + i * 0.04 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.04 + 0.85);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + i * 0.04); osc.stop(now + i * 0.04 + 0.85);
      });
    } else if (type === "stupefy") {
      // Concussive scarlet explosive stun
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc2.type = "sine";
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.22);
      osc2.frequency.setValueAtTime(880, now);
      osc2.frequency.exponentialRampToValueAtTime(180, now + 0.25);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.connect(gain); osc2.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.26);
      osc2.start(now); osc2.stop(now + 0.26);
    } else if (type === "incendio") {
      // Blazing roaring flames whoosh and crackle
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.linearRampToValueAtTime(280, now + 0.14);
      osc.frequency.exponentialRampToValueAtTime(55, now + 0.38);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.4);
    } else if (type === "clash") {
      // Priori Incantatem electric golden thread oscillation
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc1.type = "triangle";
      osc2.type = "sine";
      osc1.frequency.setValueAtTime(440, now);
      osc1.frequency.setValueAtTime(444, now + 0.05);
      osc2.frequency.setValueAtTime(220, now);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      osc1.connect(gain); osc2.connect(gain); gain.connect(ctx.destination);
      osc1.start(now); osc1.stop(now + 0.32);
      osc2.start(now); osc2.stop(now + 0.32);
    } else if (type === "duel_win") {
      // Victorious Hogwarts fanfare chord progression
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, now + idx * 0.09);
        gain.gain.setValueAtTime(0.18, now + idx * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.6);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + idx * 0.09); osc.stop(now + idx * 0.09 + 0.6);
      });
    }
  } catch { /* AudioContext might be blocked before first user gesture */ }
}
function MapClickAction({ enabled, onSelect }: { enabled: boolean; onSelect: (p: Position) => void }) {
  useMapEvents({ click(e) { if (enabled) onSelect({ lat: e.latlng.lat, lng: e.latlng.lng }); } });
  return null;
}
function MapResize({ refresh }: { refresh: number }) { const map = useMap(); useEffect(() => { const t = window.setTimeout(() => map.invalidateSize(), 120); return () => clearTimeout(t); }, [map, refresh]); return null; }
function FollowPlayer({ position }: { position: Position }) { const map = useMap(); useEffect(() => { map.setView([position.lat, position.lng], Math.max(map.getZoom(), 14), { animate: true, duration: 0.45 }); }, [map, position.lat, position.lng]); return null; }
const fieldDate = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase();

// ── XP Progress bar ────────────────────────────────────────────
function XpBar({ progression, compact = false }: { progression: UserProgression | null; compact?: boolean }) {
  const prog = progression ?? { totalXp: 0, currentLevel: 1, currentLevelTitle: "First Year Student", xpForCurrentLevel: 0, xpForNextLevel: 300, xpProgress: 0, questsCompleted: 0, artifactsCollected: 0, achievementsUnlocked: 0, userId: "" };
  if (compact) {
    return (
      <div className="xp-bar-compact">
        <div className="xp-bar-compact-header">
          <span className="xp-level-badge">Year {prog.currentLevel}</span>
          <span className="xp-title">{prog.currentLevelTitle}</span>
          <span className="xp-total">{prog.totalXp} XP</span>
        </div>
        <div className="xp-track"><div className="xp-fill" style={{ width: `${prog.xpProgress}%` }} /></div>
      </div>
    );
  }
  return (
    <div className="xp-card">
      <div className="xp-card-header">
        <div className="xp-emblem"><Compass size={18} /><span>{prog.currentLevel}</span></div>
        <div className="xp-details">
          <div className="xp-title-row"><b>Year {prog.currentLevel} · {prog.currentLevelTitle}</b><span className="xp-pts">{prog.xpForNextLevel - prog.totalXp} XP to ascend</span></div>
          <div className="xp-track"><div className="xp-fill" style={{ width: `${prog.xpProgress}%` }} /><div className="xp-glow" style={{ left: `${prog.xpProgress}%` }} /></div>
          <div className="xp-meta"><span>{prog.totalXp} / {prog.xpForNextLevel} Galleons (XP)</span><span>Hogwarts Standing</span></div>
        </div>
      </div>
      <div className="xp-stats-row">
        <div className="xp-stat"><Flag size={12} /><b>{prog.questsCompleted}</b><span>Quests</span></div>
        <div className="xp-stat"><Package size={12} /><b>{prog.artifactsCollected}</b><span>Relics</span></div>
        <div className="xp-stat"><Award size={12} /><b>{prog.achievementsUnlocked}</b><span>Accolades</span></div>
      </div>
    </div>
  );
}

// ── Level-up overlay (Hogwarts Acceptance Letter) ──────────────
function LevelUpOverlay({ levelUp, onClose }: { levelUp: { level: number; title: string } | null; onClose: () => void }) {
  useEffect(() => { if (levelUp) { const t = window.setTimeout(onClose, 5200); return () => clearTimeout(t); } }, [levelUp, onClose]);
  if (!levelUp) return null;
  return (
    <div className="levelup-overlay" onClick={onClose}>
      <div className="levelup-card hogwarts-letter">
        <div className="hogwarts-crest-wax">⚜</div>
        <div className="levelup-label">HOGWARTS SCHOOL OF WITCHCRAFT & WIZARDRY</div>
        <div className="levelup-stars">✦ ✦ ORDER OF MERLIN ASCENSION ✦ ✦</div>
        <div className="levelup-number">Year {levelUp.level}</div>
        <div className="levelup-title">{levelUp.title}</div>
        <p className="hogwarts-letter-text">
          “We are pleased to inform you that your mastery of the enchanted map and ancient relics has ascended to higher wizarding standing.”
        </p>
        <div className="levelup-tap">Tap with wand to break wax seal & continue 🪄</div>
      </div>
    </div>
  );
}

// ── Quest card ─────────────────────────────────────────────────
function QuestCard({ quest, onAccept, onComplete }: { quest: QuestSummary; onAccept?: () => void; onComplete?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const diffColors: Record<string, string> = { easy: "#6d9b6a", normal: "#8a7a44", hard: "#a05c3e", legendary: "#7a4a9e" };
  const catIcons: Record<string, React.ReactNode> = { exploration: <Compass size={11} />, mystery: <Star size={11} />, cooperative: <Users size={11} />, daily: <Zap size={11} />, weekly: <Flag size={11} />, story: <Book size={11} /> };
  return (
    <div className={`quest-card ${quest.state === "active" ? "quest-card-active" : ""} ${quest.state === "completed" ? "quest-card-done" : ""}`}>
      <div className="quest-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="quest-cat-icon">{catIcons[quest.category] ?? <Flag size={11} />}</div>
        <div className="quest-info">
          <div className="quest-name">{quest.title}</div>
          <div className="quest-meta-row">
            <span className="quest-diff" style={{ color: diffColors[quest.difficulty] }}>{quest.difficulty}</span>
            <span className="quest-xp">+{quest.xpReward} XP</span>
            {quest.state === "active" && <span className="quest-badge active">Active</span>}
            {quest.state === "completed" && <span className="quest-badge done">Completed</span>}
            {quest.state === "locked" && <span className="quest-badge locked">Locked</span>}
          </div>
        </div>
        {expanded ? <ChevronDown size={14} className="quest-chevron" /> : <ChevronRight size={14} className="quest-chevron" />}
      </div>
      {expanded && (
        <div className="quest-body">
          <p className="quest-desc">{quest.description}</p>
          {quest.storyText && <p className="quest-lore">{quest.storyText}</p>}
          {quest.artifactReward && (
            <div className="quest-artifact-reward">
              <span>{quest.artifactReward.icon}</span>
              <span>Reward: <b>{quest.artifactReward.name}</b></span>
              <span className={`rarity-badge rarity-${quest.artifactReward.rarity}`}>{quest.artifactReward.rarity}</span>
            </div>
          )}
          {quest.state === "available" && onAccept && (
            <button className="quest-accept-btn" onClick={onAccept}><Flag size={12} /> Accept Quest <ArrowUpRight size={12} /></button>
          )}
          {quest.state === "active" && onComplete && (
            <button className="quest-complete-btn" onClick={onComplete}><Check size={12} /> Complete Objective</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Artifact card ──────────────────────────────────────────────
function ArtifactCard({ artifact, collected }: { artifact: ArtifactSummary; collected: boolean }) {
  const rarityColors: Record<string, string> = { common: "#6d8a6a", uncommon: "#5a7aaa", rare: "#7a5aaa", legendary: "#aa8a2a" };
  return (
    <div className={`artifact-card rarity-${artifact.rarity} ${collected ? "artifact-collected" : "artifact-undiscovered"}`}>
      <div className="artifact-icon-wrap"><span className="artifact-icon">{collected ? artifact.icon : "?"}</span><div className="artifact-glow" /></div>
      <div className="artifact-info">
        <div className="artifact-name">{collected ? artifact.name : "Undiscovered Artifact"}</div>
        <div className="artifact-rarity-row">
          <span className={`rarity-badge rarity-${artifact.rarity}`} style={{ borderColor: rarityColors[artifact.rarity] }}>{artifact.rarity}</span>
          {collected && <span className="artifact-xp">+{artifact.xpReward} XP</span>}
        </div>
        {collected && <div className="artifact-desc">{artifact.description}</div>}
        {!collected && <div className="artifact-desc">Complete quests to reveal this artifact.</div>}
        {collected && artifact.discoveredAt && <div className="artifact-date">Found {new Date(artifact.discoveredAt).toLocaleDateString()}</div>}
      </div>
    </div>
  );
}

// ── Achievement card ───────────────────────────────────────────
function AchievementCard({ ach }: { ach: AchievementSummary }) {
  return (
    <div className={`achievement-card ${ach.unlocked ? "ach-unlocked" : "ach-locked"}`}>
      <div className="ach-icon-wrap"><span className="ach-icon">{ach.icon}</span>{ach.unlocked && <div className="ach-unlocked-glow" />}</div>
      <div className="ach-info">
        <div className="ach-title">{ach.title}</div>
        <div className="ach-desc">{ach.description}</div>
        {ach.unlocked && ach.unlockedAt && <div className="ach-date">Unlocked {new Date(ach.unlockedAt).toLocaleDateString()}</div>}
        {!ach.unlocked && ach.xpReward > 0 && <div className="ach-reward">+{ach.xpReward} XP on unlock</div>}
      </div>
      {ach.unlocked && <Check size={14} className="ach-check" />}
    </div>
  );
}

// ── Hogwarts Dueling Club Data & Types ────────────────────────
interface BotDuelist {
  id: string;
  name: string;
  title: string;
  house: "slytherin" | "gryffindor" | "ravenclaw" | "hufflepuff";
  avatar: string;
  wand: string;
  quote: string;
  difficulty: "Novice" | "Adept" | "Master" | "Formidable";
  spells: string[];
  personality: "aggressive" | "tactical" | "unpredictable" | "defensive";
}

interface DuelSpell {
  id: string;
  name: string;
  latin: string;
  icon: string;
  description: string;
  effectType: "attack" | "shield" | "dot" | "control" | "heal";
  damageRange: [number, number];
  color: string;
  cooldownTurns: number;
  sound: AudioChimeType;
}

interface DuelistParticipant {
  id: string;
  name: string;
  avatar: string;
  house: string;
  wand: string;
  isBot: boolean;
  botConfig?: BotDuelist;
}

interface DuelLogEntry {
  id: string;
  text: string;
  type: "cast" | "shield" | "damage" | "burn" | "stun" | "clash" | "victory" | "defeat";
  time: string;
}

const HOGWARTS_BOT_DUELISTS: BotDuelist[] = [
  {
    id: "bot-harry",
    name: "Harry Potter",
    title: "The Chosen One & D.A. Leader",
    house: "gryffindor",
    avatar: "🦁",
    wand: "11” Holly with Phoenix feather",
    quote: "“I must not tell lies... Expelliarmus!”",
    difficulty: "Master",
    spells: ["Expelliarmus", "Stupefy", "Protego", "Expecto Patronum"],
    personality: "tactical",
  },
  {
    id: "bot-hermione",
    name: "Hermione Granger",
    title: "Brightest Witch of Her Age & Prefect",
    house: "gryffindor",
    avatar: "📚",
    wand: "10¾” Vine wood with Dragon heartstring",
    quote: "“Honestly, don't you two read? Petrificus Totalus!”",
    difficulty: "Master",
    spells: ["Petrificus Totalus", "Protego", "Incendio", "Expelliarmus"],
    personality: "tactical",
  },
  {
    id: "bot-ron",
    name: "Ron Weasley",
    title: "Gryffindor Keeper & Chess Champion",
    house: "gryffindor",
    avatar: "♟️",
    wand: "14” Willow with Unicorn tail hair",
    quote: "“Bloody hell! You're mental if you think I'll back down!”",
    difficulty: "Adept",
    spells: ["Expelliarmus", "Stupefy", "Protego", "Petrificus Totalus"],
    personality: "unpredictable",
  },
  {
    id: "bot-ginny",
    name: "Ginny Weasley",
    title: "Bat-Bogey Hex Savant & Chaser",
    house: "gryffindor",
    avatar: "🔥",
    wand: "10” Yew wood with Phoenix feather",
    quote: "“Anything's possible if you've got enough nerve. Reducto!”",
    difficulty: "Adept",
    spells: ["Incendio", "Stupefy", "Expelliarmus", "Protego"],
    personality: "aggressive",
  },
  {
    id: "bot-draco",
    name: "Draco Malfoy",
    title: "Slytherin Seeker & Prefect",
    house: "slytherin",
    avatar: "🐍",
    wand: "10” Hawthorn with Unicorn hair",
    quote: "“Scared, are you? My father will hear of this!”",
    difficulty: "Adept",
    spells: ["Serpensortia", "Expelliarmus", "Incendio", "Protego"],
    personality: "aggressive",
  },
  {
    id: "bot-luna",
    name: "Luna Lovegood",
    title: "Ravenclaw Mystic & Seer",
    house: "ravenclaw",
    avatar: "🦅",
    wand: "Harebell wood with Thestral hair",
    quote: "“Don't worry, you're just as sane as I am.”",
    difficulty: "Novice",
    spells: ["Protego", "Petrificus Totalus", "Stupefy"],
    personality: "unpredictable",
  },
  {
    id: "bot-cedric",
    name: "Cedric Diggory",
    title: "Hogwarts Triwizard Champion",
    house: "hufflepuff",
    avatar: "🦡",
    wand: "12¼” Ash with Unicorn tail hair",
    quote: "“Wands out, let's duel fair and honorable.”",
    difficulty: "Adept",
    spells: ["Stupefy", "Incendio", "Protego", "Expelliarmus"],
    personality: "tactical",
  },
  {
    id: "bot-snape",
    name: "Severus Snape",
    title: "Potions Master & Half-Blood Prince",
    house: "slytherin",
    avatar: "🦉",
    wand: "13½” Ebony with Phoenix feather",
    quote: "“Time and space matter in magic, fool. Control your emotions.”",
    difficulty: "Master",
    spells: ["Protego", "Petrificus Totalus", "Expelliarmus", "Incendio"],
    personality: "defensive",
  },
  {
    id: "bot-bellatrix",
    name: "Bellatrix Lestrange",
    title: "Dark Sorceress & Death Eater",
    house: "slytherin",
    avatar: "⚔️",
    wand: "12¾” Walnut with Dragon heartstring",
    quote: "“Well, well, well, look what we have here! Crucio!”",
    difficulty: "Formidable",
    spells: ["Incendio", "Stupefy", "Expelliarmus", "Serpensortia"],
    personality: "aggressive",
  },
  {
    id: "bot-voldemort",
    name: "Lord Voldemort",
    title: "The Dark Lord & Heir of Slytherin",
    house: "slytherin",
    avatar: "💀",
    wand: "13½” Yew with Phoenix feather",
    quote: "“There is no good and evil, there is only power... and those too weak to seek it!”",
    difficulty: "Formidable",
    spells: ["Incendio", "Stupefy", "Serpensortia", "Petrificus Totalus"],
    personality: "aggressive",
  },
  {
    id: "bot-dumbledore",
    name: "Albus Dumbledore",
    title: "Headmaster & Order of Merlin 1st Class",
    house: "gryffindor",
    avatar: "🧙‍♂️",
    wand: "The Elder Wand (15” Elder with Thestral hair)",
    quote: "“Words are, in my not-so-humble opinion, our most inexhaustible source of magic.”",
    difficulty: "Formidable",
    spells: ["Expecto Patronum", "Protego", "Stupefy", "Incendio"],
    personality: "tactical",
  },
];

const DUEL_SPELLS: DuelSpell[] = [
  {
    id: "expelliarmus",
    name: "Expelliarmus",
    latin: "Disarming Charm",
    icon: "🪄",
    description: "Signature dueling charm. Knocks opponent off-balance with a 35% chance to disarm.",
    effectType: "attack",
    damageRange: [18, 24],
    color: "#ef4444",
    cooldownTurns: 0,
    sound: "expelliarmus",
  },
  {
    id: "stupefy",
    name: "Stupefy",
    latin: "Stunning Spell",
    icon: "⚡",
    description: "Heavy concussive scarlet blast. Deals tremendous burst magical damage.",
    effectType: "attack",
    damageRange: [26, 34],
    color: "#dc2626",
    cooldownTurns: 1,
    sound: "stupefy",
  },
  {
    id: "protego",
    name: "Protego",
    latin: "Shield Charm",
    icon: "🛡️",
    description: "Summons an ethereal silver barrier that absorbs up to 35 incoming damage.",
    effectType: "shield",
    damageRange: [0, 0],
    color: "#38bdf8",
    cooldownTurns: 2,
    sound: "protego",
  },
  {
    id: "incendio",
    name: "Incendio",
    latin: "Fire-Making Spell",
    icon: "🔥",
    description: "Conjures a roaring stream of magical fire. Deals 18 instant damage + burn over 2 turns.",
    effectType: "dot",
    damageRange: [18, 22],
    color: "#f97316",
    cooldownTurns: 2,
    sound: "incendio",
  },
  {
    id: "petrificus",
    name: "Petrificus Totalus",
    latin: "Full Body-Bind",
    icon: "🗿",
    description: "Locks the target's limbs rigid as stone. Stuns opponent, forcing them to miss next turn.",
    effectType: "control",
    damageRange: [12, 16],
    color: "#a855f7",
    cooldownTurns: 3,
    sound: "snitch",
  },
  {
    id: "patronus",
    name: "Expecto Patronum",
    latin: "Silver Guardian",
    icon: "🦌",
    description: "Summons a radiant silver corporeal guardian. Restores +25 health/morale ward.",
    effectType: "heal",
    damageRange: [0, 0],
    color: "#e2e8f0",
    cooldownTurns: 3,
    sound: "patronus",
  },
];

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("wayfinder.token") ?? "");
  const [me, setMe] = useState<Player | null>(() => { try { return JSON.parse(localStorage.getItem("wayfinder.player") ?? "null"); } catch { return null; } });
  const [room, setRoom] = useState<RoomSummary | null>(() => { try { return JSON.parse(localStorage.getItem("wayfinder.room") ?? "null"); } catch { return null; } });
  const [roomName, setRoomName] = useState("A little gathering"); const [roomCode, setRoomCode] = useState(""); const [roomError, setRoomError] = useState(""); const [gpsCenterMessage, setGpsCenterMessage] = useState("");
  const [friends, setFriends] = useState<FriendProfile[]>([]); const [incomingRequests, setIncomingRequests] = useState<FriendRequestSummary[]>([]); const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestSummary[]>([]); const [friendSearch, setFriendSearch] = useState(""); const [friendMatches, setFriendMatches] = useState<FriendProfile[]>([]); const [friendBusy, setFriendBusy] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("register");
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [avatar, setAvatar] = useState(avatars[0]);
  const [authError, setAuthError] = useState(""); const [authBusy, setAuthBusy] = useState(false);
  const [socket, setSocket] = useState<GameSocket | null>(null); const [connected, setConnected] = useState(false);
  const [position, setPosition] = useState<Position>(DEFAULT); const [players, setPlayers] = useState<PublicPlayer[]>([]); const [deviceLocated, setDeviceLocated] = useState(false); const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [collectibles, setCollectibles] = useState<Collectible[]>([]); const [missions, setMissions] = useState<Mission[]>([]); const [destinations, setDestinations] = useState<SharedDestination[]>([]);
  const [rtt, setRtt] = useState<number | null>(null); const [visibility, setVisibility] = useState<Visibility>("hidden"); const [sharePrecision, setSharePrecision] = useState<"visible" | "approximate">("visible"); const [shareDuration, setShareDuration] = useState<15 | 60>(15); const [shareExpiresAt, setShareExpiresAt] = useState<number | null>(null); const [status, setStatus] = useState<PlayerStatus>("exploring");
  const [serverHealth, setServerHealth] = useState<"checking" | "healthy" | "degraded">("checking"); const [messagesPerSecond, setMessagesPerSecond] = useState(0); const [reconnectCount, setReconnectCount] = useState(0); const [proximityEnabled, setProximityEnabled] = useState(false); const [proximityRadius, setProximityRadius] = useState<100 | 250 | 500>(250); const [destinationMode, setDestinationMode] = useState(false); const [destinationLabel, setDestinationLabel] = useState("Meet here");
  const [trails, setTrails] = useState<Record<string, Position[]>>({});
  const [notice, setNotice] = useState(""); const [activeMission, setActiveMission] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<"discover" | "quests" | "artifacts" | "potions" | "cards" | "achievements" | "players" | "friends" | "leaderboard" | "duel">("discover");
  const [panelOpen, setPanelOpen] = useState(true); const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  // Gamification state
  const [progression, setProgression] = useState<UserProgression | null>(null);
  const [quests, setQuests] = useState<QuestSummary[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [collectedArtifactIds, setCollectedArtifactIds] = useState<string[]>([]);
  const [achievements, setAchievements] = useState<AchievementSummary[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userRank, setUserRank] = useState<number | null>(null);
  const [levelUp, setLevelUp] = useState<{ level: number; title: string } | null>(null);
  const [xpToast, setXpToast] = useState<XpGrant | null>(null);
  const [questTab, setQuestTab] = useState<"available" | "active" | "completed">("available");
  const [faction, setFaction] = useState<FactionType>("gryffindor");
  const [isMapRevealed, setIsMapRevealed] = useState(false);
  const [isRevealing, setIsRevealing] = useState(false);
  const [isMischiefManaging, setIsMischiefManaging] = useState(false);
  const [customAuthOpen, setCustomAuthOpen] = useState(false);
  const [spires, setSpires] = useState<Spire[]>([]);
  const [snitch, setSnitch] = useState<GoldenSnitch | null>(null);
  const [traps, setTraps] = useState<RuneTrap[]>([]);
  const [feed, setFeed] = useState<GameEventFeedItem[]>([]);
  const [cooldowns, setCooldowns] = useState<Record<SpellType, number>>({ lumos: 0, cloak: 0, trap: 0, ping: 0 });
  const [lumosWave, setLumosWave] = useState<{ position: Position; radiusM: number } | null>(null);
  const [isCloaked, setIsCloaked] = useState(false);
  const [radarPing, setRadarPing] = useState<{ from: Position; target: Position } | null>(null);
  const [dailyMischief, setDailyMischief] = useState<{ lumos: boolean; snitch: boolean; trap: boolean; spire: boolean }>({
    lumos: false,
    snitch: false,
    trap: false,
    spire: false,
  });
  const [mapLayer, setMapLayer] = useState<"street" | "topo">("street");

  // Interactive HP Gameplay State
  const [broomstickActive, setBroomstickActive] = useState(false);
  const [liquidLuckActive, setLiquidLuckActive] = useState(false);
  const [patronusWave, setPatronusWave] = useState<{ position: Position; radiusM: number } | null>(null);
  const [dementors, setDementors] = useState<Array<{ id: string; name: string; position: Position }>>([]);
  const [dementorThreat, setDementorThreat] = useState(false);
  const [boggarts, setBoggarts] = useState<Array<{ id: string; name: string; position: Position; fear: string; funny: string }>>([]);
  const [activeBoggart, setActiveBoggart] = useState<{ id: string; name: string; fear: string; funny: string } | null>(null);
  const [chocolateFrogs, setChocolateFrogs] = useState<Array<{ id: string; position: Position }>>([]);
  const [collectedFrogCards, setCollectedFrogCards] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("hp_frog_cards") ?? "[\"dumbledore\",\"potter\"]"); } catch { return ["dumbledore", "potter"]; }
  });
  const [newFrogCardWon, setNewFrogCardWon] = useState<(typeof FROG_CARDS)[0] | null>(null);
  const [inspectedCard, setInspectedCard] = useState<(typeof FROG_CARDS)[0] | null>(null);
  const [snitchCelebration, setSnitchCelebration] = useState<{ points: number } | null>(null);
  const [sortingHatOpen, setSortingHatOpen] = useState(false);
  const [sortingQuestionIndex, setSortingQuestionIndex] = useState(0);
  const [sortingThinking, setSortingThinking] = useState(false);
  const [activePotionEffect, setActivePotionEffect] = useState<{ name: string; expiresAt: number } | null>(null);

  // ── Hogwarts Dueling Club State ──
  const [duelActive, setDuelActive] = useState(false);
  const [duelOpponent, setDuelOpponent] = useState<DuelistParticipant | null>(null);
  const [duelPlayerHp, setDuelPlayerHp] = useState(100);
  const [duelOpponentHp, setDuelOpponentHp] = useState(100);
  const [duelPlayerShield, setDuelPlayerShield] = useState(0);
  const [duelOpponentShield, setDuelOpponentShield] = useState(0);
  const [duelPlayerStunned, setDuelPlayerStunned] = useState(false);
  const [duelOpponentStunned, setDuelOpponentStunned] = useState(false);
  const [duelPlayerBurn, setDuelPlayerBurn] = useState(0);
  const [duelOpponentBurn, setDuelOpponentBurn] = useState(0);
  const [duelSpellCooldowns, setDuelSpellCooldowns] = useState<Record<string, number>>({});
  const [duelSpellAnimation, setDuelSpellAnimation] = useState<{ caster: "player" | "opponent"; spell: string; color: string } | null>(null);
  const [duelSpeechBubble, setDuelSpeechBubble] = useState<{ speaker: "player" | "opponent"; text: string } | null>(null);
  const [duelLog, setDuelLog] = useState<DuelLogEntry[]>([]);
  const [duelTurnCount, setDuelTurnCount] = useState(1);
  const [duelOutcome, setDuelOutcome] = useState<"victory" | "defeat" | null>(null);
  const [duelWinsCount, setDuelWinsCount] = useState<number>(() => {
    try { return Number(localStorage.getItem("hp_duel_wins") ?? "0"); } catch { return 0; }
  });

  // Priori Incantatem Clash State
  const [isClashing, setIsClashing] = useState(false);
  const [clashTug, setClashTug] = useState(50);
  const [clashTimer, setClashTimer] = useState(6);

  // Incoming Challenge Prompt
  const [incomingChallenge, setIncomingChallenge] = useState<{
    fromId: string;
    fromName: string;
    fromFaction?: string;
    fromAvatar?: string;
  } | null>(null);

  // Real-time Device Movement Detection
  const [deviceTrackingActive, setDeviceTrackingActive] = useState(true);
  const [deviceMovementStatus, setDeviceMovementStatus] = useState<"searching" | "stationary" | "moving" | "denied">("searching");
  const [lastMovementMeters, setLastMovementMeters] = useState(0);
  const [distanceMovedTotal, setDistanceMovedTotal] = useState(0);
  const lastMovedPositionRef = useRef<Position | null>(null);
  const movementResetTimer = useRef<number | undefined>();

  const houseScores = useMemo(() => {
    const scores: Record<string, number> = { gryffindor: 420, slytherin: 405, ravenclaw: 390, hufflepuff: 375 };
    leaderboard.forEach((entry) => {
      const k = entry.username.length % 4 === 0 ? "gryffindor" : entry.username.length % 4 === 1 ? "slytherin" : entry.username.length % 4 === 2 ? "ravenclaw" : "hufflepuff";
      scores[k] = (scores[k] ?? 0) + Math.min(220, entry.xpTotal);
    });
    if (progression) {
      const userHouse = faction === "gryffindor" || faction === "slytherin" || faction === "ravenclaw" || faction === "hufflepuff" ? faction : "gryffindor";
      scores[userHouse] = (scores[userHouse] ?? 0) + Math.min(450, progression.totalXp);
    }
    return scores;
  }, [leaderboard, progression, faction]);

  const maxHouseScore = useMemo(() => Math.max(500, ...Object.values(houseScores)), [houseScores]);

  const seq = useRef(0); const posRef = useRef(position); const socketRef = useRef<GameSocket | null>(null); const [mapRefresh, setMapRefresh] = useState(0);
  const roomRef = useRef<RoomSummary | null>(room);
  const geoWatch = useRef<number | undefined>(); const shareTimer = useRef<number | undefined>(); const messageCount = useRef(0);
  const playerPositions = useRef(new Map<string, Position>());

  useEffect(() => { posRef.current = position; }, [position]);
  useEffect(() => { if (!notice) return; const t = window.setTimeout(() => setNotice(""), 3800); return () => clearTimeout(t); }, [notice]);
  useEffect(() => { if (!xpToast) return; const t = window.setTimeout(() => setXpToast(null), 3000); return () => clearTimeout(t); }, [xpToast]);

  useEffect(() => {
    if (dementors.length === 0 && position.lat) {
      setDementors([
        { id: "dem-1", name: "Dementor of Azkaban", position: { lat: position.lat + 0.0018, lng: position.lng - 0.0019 } },
        { id: "dem-2", name: "Dementor of the Black Lake", position: { lat: position.lat - 0.0022, lng: position.lng + 0.0021 } },
      ]);
    }
    if (boggarts.length === 0 && position.lat) {
      setBoggarts([
        { id: "bog-1", name: "Rattling Wardrobe", position: { lat: position.lat + 0.0012, lng: position.lng + 0.0014 }, fear: "A towering Dementor reaching forward!", funny: "Severus Snape in a vulture hat and green floral dress!" },
        { id: "bog-2", name: "Creaking Grandfather Clock", position: { lat: position.lat - 0.0014, lng: position.lng - 0.0016 }, fear: "A giant venomous Acromantula spider!", funny: "A giant spider wearing eight roller skates, slipping backwards!" },
      ]);
    }
    if (chocolateFrogs.length === 0 && position.lat) {
      setChocolateFrogs([
        { id: "frog-1", position: { lat: position.lat + 0.0008, lng: position.lng - 0.0012 } },
        { id: "frog-2", position: { lat: position.lat - 0.0011, lng: position.lng + 0.0009 } },
        { id: "frog-3", position: { lat: position.lat + 0.0019, lng: position.lng + 0.0018 } },
      ]);
    }
  }, [position.lat, position.lng, dementors.length, boggarts.length, chocolateFrogs.length]);

  const authHeaders = useMemo(() => ({ authorization: `Bearer ${token}`, "content-type": "application/json" }), [token]);

  const loadProgression = useCallback(async () => {
    if (!token) return;
    try { const data = await apiFetch(`${API}/progression`, { headers: { authorization: `Bearer ${token}` } }); if (data.progression) setProgression(data.progression); } catch { /* non-critical */ }
  }, [token]);

  const loadQuests = useCallback(async () => {
    if (!token) return;
    try { const data = await apiFetch(`${API}/quests`, { headers: { authorization: `Bearer ${token}` } }); if (data.quests) setQuests(data.quests); } catch { /* non-critical */ }
  }, [token]);

  const loadArtifacts = useCallback(async () => {
    if (!token) return;
    try { const data = await apiFetch(`${API}/artifacts`, { headers: { authorization: `Bearer ${token}` } }); if (data.artifacts) { setArtifacts(data.artifacts); setCollectedArtifactIds(data.collected ?? []); } } catch { /* non-critical */ }
  }, [token]);

  const loadAchievements = useCallback(async () => {
    if (!token) return;
    try { const data = await apiFetch(`${API}/achievements`, { headers: { authorization: `Bearer ${token}` } }); if (data.achievements) setAchievements(data.achievements); } catch { /* non-critical */ }
  }, [token]);

  const loadLeaderboard = useCallback(async () => {
    if (!token) return;
    try { const data = await apiFetch(`${API}/leaderboard`, { headers: { authorization: `Bearer ${token}` } }); if (data.entries) { setLeaderboard(data.entries); setUserRank(data.userRank); } } catch { /* non-critical */ }
  }, [token]);

  async function authenticate(e: FormEvent) {
    e.preventDefault(); setAuthError(""); setAuthBusy(true);
    try {
      const response = await fetch(`${API}/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password, avatar }) });
      const result = await apiFetch(`${API}/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password, avatar }) });
      void response;
      if (!result.token) throw new Error(result.error ?? "Could not sign in.");
      localStorage.setItem("wayfinder.token", result.token); localStorage.setItem("wayfinder.player", JSON.stringify(result.player)); setToken(result.token); setMe(result.player);
    } catch (error) { setAuthError(error instanceof TypeError ? "Can't reach the Wayfinder server. Start local services and try again." : error instanceof Error ? error.message : "Could not sign in."); }
    finally { setAuthBusy(false); }
  }

  async function quickPlayGuest() {
    setAuthError(""); setAuthBusy(true);
    try {
      const result = await apiFetch(`${API}/auth/guest`, { method: "POST" });
      if (!result.token) throw new Error(result.error ?? "Could not start guest session.");
      localStorage.setItem("wayfinder.token", result.token);
      localStorage.setItem("wayfinder.player", JSON.stringify(result.player));
      setToken(result.token);
      setMe(result.player);
      setRoomCode("REALM001");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not start guest session.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function revealMap() {
    playAudioChime("solemn");
    setIsRevealing(true);

    if (!token || !me) {
      try {
        const result = await apiFetch(`${API}/auth/guest`, { method: "POST" });
        if (result.token && result.player) {
          localStorage.setItem("wayfinder.token", result.token);
          localStorage.setItem("wayfinder.player", JSON.stringify(result.player));
          setToken(result.token);
          setMe(result.player);
          setRoomCode("REALM001");
        }
      } catch {
        const guestPlayer = { id: "marauder-" + Date.now(), username: "Moony", avatar: "🪄", score: 0 };
        setToken("guest-token");
        setMe(guestPlayer);
      }
    }

    if (socket?.connected && !roomRef.current) {
      socket.emit("room:join", { code: "REALM001" }, (reply) => {
        if (reply.ok && reply.room) {
          enterRoom(reply.room, socket);
        }
      });
    }

    window.setTimeout(() => {
      setIsRevealing(false);
      setIsMapRevealed(true);
      setNotice("“I solemnly swear that I am up to no good.” 🪄 The map unfolds before your eyes!");
      if (navigator.geolocation) {
        locate();
      }
    }, 1200);
  }

  function manageMischief() {
    playAudioChime("mischief");
    setIsMischiefManaging(true);
    if (visibility !== "hidden") {
      stopLocationSharing(true);
    }
    setLumosWave(null);
    setIsCloaked(false);
    setRadarPing(null);

    window.setTimeout(() => {
      setIsMischiefManaging(false);
      setIsMapRevealed(false);
      setNotice("“Mischief managed.” ✨ The parchment is wiped clean.");
    }, 2200);
  }

  function castSpell(spell: SpellType) {
    if ((cooldowns[spell] ?? 0) > Date.now()) {
      playAudioChime("cooldown");
      setNotice(`Spell on cooldown for ${Math.ceil(((cooldowns[spell] ?? 0) - Date.now()) / 1000)}s.`);
      return;
    }

    // Play spell sound immediately on click!
    if (spell === "lumos") {
      playAudioChime("lumos");
      setDailyMischief((d) => ({ ...d, lumos: true }));
      setLumosWave({ position: posRef.current, radiusM: 350 });
      setTimeout(() => setLumosWave(null), 3200);
      setNotice("✨ Lumos Solarem cast! Secrets within 350m illuminated.");
    } else if (spell === "cloak") {
      playAudioChime("cloak");
      setIsCloaked(true);
      setTimeout(() => setIsCloaked(false), 15_000);
      setNotice("👤 Disillusionment Charm active! Your tracks are hidden for 15s.");
    } else if (spell === "trap") {
      playAudioChime("trap");
      setDailyMischief((d) => ({ ...d, trap: true }));
      setNotice("⚡ Arcane Rune Trap placed! Awaiting an unsuspecting rival.");
    } else if (spell === "ping") {
      playAudioChime("ping");
      setDailyMischief((d) => ({ ...d, snitch: true }));
      setNotice("🧭 Marauder Radar pulsed! Scanning castle grounds.");
    }

    const cdDuration = spell === "lumos" ? 15_000 : spell === "cloak" ? 25_000 : spell === "trap" ? 20_000 : 12_000;
    setCooldowns((prev) => ({ ...prev, [spell]: Date.now() + cdDuration }));

    if (!socket?.connected) return;

    socket.emit("spell:cast", { spell }, (reply) => {
      if (!reply.ok) {
        if (reply.cooldownRemainingMs) {
          setCooldowns((prev) => ({ ...prev, [spell]: Date.now() + reply.cooldownRemainingMs! }));
        }
        setNotice(reply.error ?? "Could not cast spell.");
        return;
      }
      if (spell === "ping" && reply.spellEvent?.targetPosition) {
        setRadarPing({ from: position, target: reply.spellEvent.targetPosition });
        setTimeout(() => setRadarPing(null), 6000);
        setNotice("🧭 Marauder Radar locked onto objective vector!");
      }
    });
  }

  function catchSnitch(snitchId: string) {
    playAudioChime("snitch");
    setDailyMischief((d) => ({ ...d, snitch: true }));
    setSnitchCelebration({ points: 150 });
    const xpBonus = liquidLuckActive ? 300 : 150;
    setNotice(`✨ Golden Snitch caught! +${xpBonus} XP jackpot & 150 House Points!`);
    if (progression) {
      setProgression((p) => p ? { ...p, totalXp: p.totalXp + xpBonus } : p);
    }
    if (socket?.connected) {
      socket.emit("snitch:catch", { snitchId }, () => {});
    }
    setSnitch(null);
  }

  const castPatronus = useCallback(() => {
    playAudioChime("patronus");
    setPatronusWave({ position: posRef.current, radiusM: 260 });
    setTimeout(() => setPatronusWave(null), 3500);

    const banished = dementors.filter((d) => distanceMeters(posRef.current, d.position) <= 260);
    if (banished.length > 0) {
      setDementors((prev) => prev.filter((d) => distanceMeters(posRef.current, d.position) > 260));
      setDementorThreat(false);
      const xpBonus = liquidLuckActive ? 150 : 75;
      setNotice(`🦌 EXPECTO PATRONUM! A radiant silver Patronus banished ${banished.length} Dementor${banished.length > 1 ? "s" : ""}! +${xpBonus} XP & House Points awarded!`);
      setXpToast({ amount: xpBonus, source: "Expecto Patronum: Azkaban Guard Banished", totalXp: (progression?.totalXp ?? 0) + xpBonus });
      if (progression) {
        setProgression((p) => p ? { ...p, totalXp: p.totalXp + xpBonus } : p);
      }
    } else {
      setNotice("🦌 EXPECTO PATRONUM! A majestic silver Patronus soars overhead, illuminating the castle grounds!");
    }
  }, [dementors, liquidLuckActive, progression]);

  const castExpelliarmus = useCallback(() => {
    playAudioChime("expelliarmus");
    setNotice("⚡ EXPELLIARMUS! A blinding scarlet dueling jet erupts from your wand!");
    const trapsDisarmed = traps.filter((t) => t.ownerId !== me?.id && distanceMeters(posRef.current, t.position) <= 180);
    if (trapsDisarmed.length > 0) {
      setTraps((prev) => prev.filter((t) => !trapsDisarmed.some((td) => td.id === t.id)));
      setNotice(`⚡ Expelliarmus disarmed ${trapsDisarmed.length} enemy Rune Trap${trapsDisarmed.length > 1 ? "s" : ""}! (+50 XP)`);
    }
  }, [me?.id, traps]);

  const castRiddikulus = useCallback((boggart: { id: string; name: string; fear: string; funny: string }) => {
    playAudioChime("riddikulus");
    setNotice(`✨ RIDDIKULUS! The wardrobe bursts open in laughter! ${boggart.funny} (+50 XP)`);
    setBoggarts((prev) => prev.filter((b) => b.id !== boggart.id));
    setActiveBoggart(null);
    const xpBonus = liquidLuckActive ? 100 : 50;
    setXpToast({ amount: xpBonus, source: "Riddikulus: Boggart Banished", totalXp: (progression?.totalXp ?? 0) + xpBonus });
    if (progression) {
      setProgression((p) => p ? { ...p, totalXp: p.totalXp + xpBonus } : p);
    }
  }, [liquidLuckActive, progression]);

  const brewPotion = useCallback((potionId: string) => {
    const recipe = POTION_RECIPES.find((p) => p.id === potionId);
    if (!recipe) return;
    playAudioChime("potion");
    if (potionId === "felix") {
      setLiquidLuckActive(true);
      setActivePotionEffect({ name: recipe.name, expiresAt: Date.now() + 60_000 });
      setTimeout(() => setLiquidLuckActive(false), 60_000);
      setNotice("🌟 Felix Felicis brewed! Liquid Luck courses through you: 2x XP bonus on all actions for 60s!");
    } else if (potionId === "pepperup") {
      setBroomstickActive(true);
      setActivePotionEffect({ name: recipe.name, expiresAt: Date.now() + 45_000 });
      setNotice("⚡ Pepperup Potion drank! Steam shoots from your ears! Broomstick flight speed activated for 45s!");
    } else if (potionId === "polyjuice") {
      const disguises = ["🧙‍♂️", "⚡", "🔮", "✨", "👑"];
      const randomDisguise = disguises[Math.floor(Math.random() * disguises.length)];
      setMe((prev) => prev ? { ...prev, avatar: randomDisguise } : prev);
      setActivePotionEffect({ name: recipe.name, expiresAt: Date.now() + 90_000 });
      setNotice(`🎭 Polyjuice Potion consumed! You have assumed the appearance of a master wizard (${randomDisguise}) for 90s!`);
    }
  }, []);

  const answerSortingQuestion = useCallback((house: FactionType) => {
    setSortingThinking(true);
    playAudioChime("solemn");
    setTimeout(() => {
      if (sortingQuestionIndex < SORTING_QUESTIONS.length - 1) {
        setSortingQuestionIndex((i) => i + 1);
        setSortingThinking(false);
      } else {
        setSortingThinking(false);
        setSortingHatOpen(false);
        selectFaction(house);
        setNotice(`🎩 The Sorting Hat bellows: “...${house.toUpperCase()}!” 🏰 Welcome to House ${HOUSE_DATA[house].name}! +60 House Points!`);
        setXpToast({ amount: 60, source: `Sorting Hat: House ${HOUSE_DATA[house].name}`, totalXp: (progression?.totalXp ?? 0) + 60 });
      }
    }, 900);
  }, [sortingQuestionIndex, progression]);

  function tagCrown(targetPlayerId: string) {
    if (!socket?.connected) return;
    socket.emit("bounty:tag", { targetPlayerId }, (reply) => {
      if (!reply.ok) { setNotice(reply.error ?? "Could not tag Crowned player."); return; }
      playAudioChime("snitch");
      setNotice(`🎯 Crowned Marauder tagged! Stole +${reply.xpStolen} XP bounty!`);
    });
  }

  function selectFaction(nextFaction: FactionType) {
    setFaction(nextFaction);
    socket?.emit("player:faction", { faction: nextFaction });
    const houseNames: Record<string, string> = {
      gryffindor: "Gryffindor 🦁 (Bravery & Chivalry)",
      slytherin: "Slytherin 🐍 (Ambition & Cunning)",
      ravenclaw: "Ravenclaw 🦅 (Wisdom & Wit)",
      hufflepuff: "Hufflepuff 🦡 (Loyalty & Dedication)",
    };
    setNotice(`Sorted into House ${houseNames[nextFaction] ?? nextFaction.toUpperCase()}! 🏰`);
  }

  function enterRoom(nextRoom: RoomSummary, activeSocket = socketRef.current) {
    roomRef.current = nextRoom; setRoom(nextRoom); localStorage.setItem("wayfinder.room", JSON.stringify(nextRoom)); setRoomError("");
    if (!activeSocket?.connected) return;
    activeSocket.emit("game:join", { position: posRef.current, visibility: "hidden" }, (reply) => {
      if (!reply.ok) { setRoomError(reply.error ?? "Could not open the room map."); return; }
      const snapshot = reply.players ?? []; playerPositions.current = new Map(snapshot.map((p) => [p.id, p.position]));
      setPlayers(snapshot); setTrails(Object.fromEntries(snapshot.map((p) => [p.id, [p.position]])));
      setCollectibles(reply.collectibles ?? []); setMissions(reply.missions ?? []); setDestinations(reply.destinations ?? []);
      if (reply.spires) setSpires(reply.spires);
      if (reply.snitch) setSnitch(reply.snitch);
      if (reply.traps) setTraps(reply.traps);
      if (reply.feed) setFeed(reply.feed);
    });
  }
  function createRoom(e: FormEvent) {
    e.preventDefault(); if (!socket?.connected) return setRoomError("Wait for the secure connection before creating a room.");
    socket.emit("room:create", { name: roomName }, (reply) => { if (!reply.ok || !reply.room) return setRoomError(reply.error ?? "Could not create the room."); enterRoom(reply.room, socket); });
  }
  function joinRoom(e: FormEvent) {
    e.preventDefault(); if (!socket?.connected) return setRoomError("Wait for the secure connection before joining a room.");
    socket.emit("room:join", { code: roomCode }, (reply) => { if (!reply.ok || !reply.room) return setRoomError(reply.error ?? "Could not join the room."); enterRoom(reply.room, socket); });
  }
  function leaveRoom() { stopLocationSharing(false, false); socketRef.current?.emit("room:leave"); roomRef.current = null; setRoom(null); localStorage.removeItem("wayfinder.room"); setPlayers([]); setTrails({}); setDestinations([]); setRoomCode(""); }
  function endRoom() { stopLocationSharing(false, false); socketRef.current?.emit("room:end"); }

  async function refreshSocial() {
    if (!token) return;
    try {
      const headers = { authorization: `Bearer ${token}` };
      const [friendsData, incomingData, outgoingData] = await Promise.all([
        apiFetch(`${API}/friends`, { headers }),
        apiFetch(`${API}/friends/requests/incoming`, { headers }),
        apiFetch(`${API}/friends/requests/outgoing`, { headers }),
      ]);
      setFriends(friendsData.friends ?? []); setIncomingRequests(incomingData.requests ?? []); setOutgoingRequests(outgoingData.requests ?? []);
    } catch { /* dashboard remains usable */ }
  }

  async function searchPeople(e: FormEvent) {
    e.preventDefault(); if (!friendSearch.trim()) return; setFriendBusy(true);
    try { const data = await apiFetch(`${API}/users/search?q=${encodeURIComponent(friendSearch.trim())}`, { headers: { authorization: `Bearer ${token}` } }); setFriendMatches(data.users ?? []); }
    catch { setNotice("User search is temporarily unavailable."); } finally { setFriendBusy(false); }
  }
  async function sendFriendRequest(person: FriendProfile) {
    try { const data = await apiFetch(`${API}/friends/requests`, { method: "POST", headers: authHeaders, body: JSON.stringify({ userId: person.id }) }); if (!data.token && data.error) throw new Error(data.error); setNotice(`Friend request sent to ${person.username}.`); await refreshSocial(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not send that request."); }
  }
  async function respondToFriendRequest(requestId: string, action: "accept" | "reject") {
    try { const data = await apiFetch(`${API}/friends/requests/${requestId}/${action}`, { method: "POST", headers: authHeaders }); if (data.error) throw new Error(data.error); setNotice(action === "accept" ? "Friend request accepted." : "Friend request declined."); await refreshSocial(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not update that request."); }
  }
  async function removeFriend(friend: FriendProfile) {
    try { const data = await apiFetch(`${API}/friends/${friend.id}`, { method: "DELETE", headers: authHeaders }); if (data.error) throw new Error(data.error); setNotice(`${friend.username} was removed from your friends.`); await refreshSocial(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not remove that friend."); }
  }

  async function acceptQuest(questId: string) {
    try {
      const data = await apiFetch(`${API}/quests/${questId}/accept`, { method: "POST", headers: authHeaders });
      if (data.error) throw new Error(data.error);
      setNotice("Quest accepted! Check your Quest Journal.");
      await loadQuests();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not accept quest."); }
  }

  async function completeQuestObjective(questId: string, objectiveId: string, answer?: string) {
    try {
      const data = await apiFetch(`${API}/quests/${questId}/objective/${objectiveId}/complete`, { method: "POST", headers: authHeaders, body: JSON.stringify({ answer }) });
      if (data.error) throw new Error(data.error);
      if (data.xpGrant) {
        setXpToast(data.xpGrant);
        await loadProgression();
        if (data.xpGrant.newLevel) {
          setLevelUp({ level: data.xpGrant.newLevel, title: progression?.currentLevelTitle ?? "" });
        }
      }
      if (data.allComplete) setNotice("🎉 Quest complete! Rewards granted.");
      else setNotice("Objective completed! Keep going.");
      await loadQuests();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not complete objective."); }
  }

  function stopLocationSharing(expired = false, notifyServer = true) {
    if (geoWatch.current !== undefined && navigator.geolocation) navigator.geolocation.clearWatch(geoWatch.current);
    geoWatch.current = undefined; if (shareTimer.current) window.clearTimeout(shareTimer.current); shareTimer.current = undefined;
    setVisibility("hidden"); setShareExpiresAt(null); setProximityEnabled(false); setDestinationMode(false);
    if (me) setDestinations((items) => items.filter((item) => item.ownerId !== me.id));
    if (notifyServer) socketRef.current?.emit("player:share", { enabled: false });
    if (expired) setNotice("Your timed location share ended. Your marker is hidden.");
  }
  function signOut() { stopLocationSharing(); socketRef.current?.disconnect(); socketRef.current = null; setSocket(null); setToken(""); setMe(null); localStorage.removeItem("wayfinder.token"); localStorage.removeItem("wayfinder.player"); }

  useEffect(() => {
    if (!token || !me) return;
    let alive = true;
    const s: GameSocket = io(WS, { transports: ["websocket"], auth: { token }, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 600, reconnectionDelayMax: 5000 });
    socketRef.current = s; setSocket(s);
    const rejoinRoom = () => {
      const savedRoom = roomRef.current; if (!savedRoom) return;
      s.emit("room:rejoin", { roomId: savedRoom.id }, (reply) => {
        if (!alive) return;
        if (!reply.ok || !reply.room) { roomRef.current = null; setRoom(null); localStorage.removeItem("wayfinder.room"); setPlayers([]); setNotice(reply.error ?? "Rejoin with a current room invite code."); return; }
        enterRoom(reply.room, s);
      });
    };
    s.onAny(() => { messageCount.current += 1; });
    s.on("connect", () => { if (!alive) return; setConnected(true); rejoinRoom(); });
    s.on("disconnect", () => { if (alive) { setConnected(false); stopLocationSharing(); } });
    s.on("connect_error", (error) => { if (alive) { setConnected(false); setNotice(error.message.includes("session") ? "Session expired. Please sign in again." : "Reconnecting to the map…"); } });
    s.io.on("reconnect", () => { if (alive) setReconnectCount((count) => count + 1); });
    void refreshSocial();
    void loadProgression();
    void loadQuests();
    void loadArtifacts();
    void loadAchievements();
    s.on("friend:request-received", ({ sender }) => { if (alive) { setNotice(`${sender.username} sent you a friend request.`); void refreshSocial(); } });
    s.on("friend:request-accepted", ({ username: friendName }) => { if (alive) { setNotice(`${friendName} accepted your friend request.`); void refreshSocial(); } });
    s.on("player:joined", (p) => { playerPositions.current.set(p.id, p.position); setTrails((old) => ({ ...old, [p.id]: [p.position] })); setPlayers((list) => list.some((x) => x.id === p.id) ? list : [...list, p]); });
    s.on("player:moved", ({ playerId, position: p, sequence }) => { const previous = playerPositions.current.get(playerId); playerPositions.current.set(playerId, p); setTrails((old) => ({ ...old, [playerId]: [...(old[playerId] ?? (previous ? [previous] : [])), p].slice(-14) })); setPlayers((list) => list.map((x) => x.id === playerId ? { ...x, position: p, sequence, lastSeen: Date.now() } : x)); });
    s.on("player:left", ({ playerId }) => { playerPositions.current.delete(playerId); setPlayers((list) => list.filter((p) => p.id !== playerId)); setTrails((old) => { const next = { ...old }; delete next[playerId]; return next; }); });
    s.on("player:updated", (update) => setPlayers((list) => list.map((p) => p.id === update.id ? { ...p, ...update } : p)));
    s.on("player:share-expired", () => { if (alive) stopLocationSharing(true); });
    s.on("room:ended", () => { if (!alive) return; stopLocationSharing(false, false); roomRef.current = null; setRoom(null); localStorage.removeItem("wayfinder.room"); setPlayers([]); setTrails({}); setDestinations([]); setNotice("You left the room. Your location is no longer shared."); });
    s.on("proximity:alert", ({ username, distanceMeters: meters }) => { if (alive) setNotice(`${username} is within ${meters} m of you.`); });
    s.on("destination:shared", (destination) => { if (alive) setDestinations((list) => [...list.filter((item) => item.ownerId !== destination.ownerId), destination]); });
    s.on("destination:removed", ({ destinationId }) => { if (alive) setDestinations((list) => list.filter((item) => item.id !== destinationId)); });
    s.on("item:collected", ({ itemId, username: who, points }) => {
      setCollectibles((list) => list.filter((item) => item.id !== itemId));
      setNotice(`${who} found a collectible · +${points} XP`);
      if (who === me.username) { void loadProgression(); }
    });
    s.on("mission:updated", ({ missionId, playerId, state }) => {
      if (playerId !== me.id) return;
      if (state === "started") { setActiveMission(missionId); setStatus("on-mission"); }
      else { setActiveMission(null); setStatus("exploring"); void loadProgression(); setNotice("Quest complete. Experience added to your field rank."); }
    });
    // Gamification socket events
    s.on("xp:granted", (grant) => {
      if (!alive) return;
      setXpToast(grant);
      void loadProgression();
    });
    s.on("level:up", (payload) => {
      if (!alive) return;
      setLevelUp({ level: payload.newLevel, title: payload.newTitle || progression?.currentLevelTitle || "" });
      void loadProgression();
    });
    s.on("quest:completed", (payload) => {
      if (!alive) return;
      setXpToast(payload.xpGrant);
      setNotice(`🎉 Quest complete! +${payload.xpGrant.amount} XP earned.`);
      void loadQuests();
      void loadProgression();
      if (payload.artifactReward) void loadArtifacts();
    });
    s.on("achievement:unlocked", (ach) => {
      if (!alive) return;
      setNotice(`🏆 Achievement unlocked: ${ach.title}!`);
      setAchievements((list) => list.map((a) => a.id === ach.id ? { ...ach } : a));
      void loadProgression();
    });
    s.on("artifact:discovered", (artifact) => {
      if (!alive) return;
      setNotice(`✨ Artifact discovered: ${artifact.name}!`);
      setCollectedArtifactIds((ids) => [...ids, artifact.id]);
      void loadArtifacts();
    });
    // .io Spell and World events
    s.on("spell:casted", (event) => {
      if (!alive) return;
      if (event.spell === "lumos") {
        setLumosWave({ position: event.position, radiusM: event.radiusM ?? 350 });
        setTimeout(() => setLumosWave(null), 3200);
      }
    });
    s.on("trap:placed", (trap) => {
      if (!alive) return;
      setTraps((prev) => [...prev.filter((t) => t.id !== trap.id), trap]);
    });
    s.on("trap:triggered", (payload) => {
      if (!alive) return;
      setTraps((prev) => prev.filter((t) => t.id !== payload.trapId));
      playAudioChime("trap");
      setNotice(`💥 ${payload.victimName} stepped on a Rune Trap! (+${payload.xpAwarded} XP)`);
    });
    s.on("spires:update", (updated) => { if (alive) setSpires(updated); });
    s.on("spire:captured", (payload) => {
      if (!alive) return;
      playAudioChime("spire");
      setNotice(`🚩 ${payload.capturerName} conquered ${payload.spireName} for House ${payload.faction.toUpperCase()}!`);
    });
    s.on("snitch:spawned", (sData) => {
      if (!alive) return;
      setSnitch(sData);
      setNotice("✨ The Golden Snitch has appeared in the skies!");
    });
    s.on("snitch:moved", (payload) => {
      if (!alive) return;
      setSnitch((prev) => (prev ? { ...prev, position: payload.position } : prev));
    });
    s.on("snitch:caught", (payload) => {
      if (!alive) return;
      playAudioChime("snitch");
      setNotice(`✨ ${payload.catcherName} caught the Golden Snitch (+${payload.points} XP)!`);
      setSnitch(null);
    });
    s.on("bounty:crowned", (payload) => {
      if (!alive) return;
      setNotice(`👑 ${payload.username} has claimed the Marauder Crown!`);
      setPlayers((prev) => prev.map((p) => ({ ...p, isCrowned: p.id === payload.playerId })));
    });
    s.on("feed:item", (item) => {
      if (!alive) return;
      setFeed((prev) => [...prev.slice(-15), item]);
    });

    // Hogwarts Dueling Club Socket Listeners
    s.on("duel:invitation", ({ fromId, fromName, fromFaction, fromAvatar }) => {
      if (!alive) return;
      playAudioChime("solemn");
      setIncomingChallenge({ fromId, fromName, fromFaction, fromAvatar });
      setNotice(`⚔️ ${fromName} challenges you to a wand duel on the Great Hall stage!`);
    });

    s.on("duel:opponent_action", ({ spell, damage, shield, message }) => {
      if (!alive) return;
      setDuelSpellAnimation({ caster: "opponent", spell, color: shield ? "#38bdf8" : "#ef4444" });
      setTimeout(() => setDuelSpellAnimation(null), 900);
      setDuelSpeechBubble({ speaker: "opponent", text: `“${spell}!”` });
      setTimeout(() => setDuelSpeechBubble(null), 2400);

      if (shield) {
        setDuelOpponentShield(35);
        playAudioChime("protego");
      } else {
        playAudioChime(spell.toLowerCase().includes("expelliarmus") ? "expelliarmus" : spell.toLowerCase().includes("incendio") ? "incendio" : "stupefy");
        setDuelPlayerShield((prevShield) => {
          const absorbed = Math.min(prevShield, damage);
          const remainder = damage - absorbed;
          if (remainder > 0) {
            setDuelPlayerHp((h) => {
              const next = Math.max(0, h - remainder);
              if (next <= 0) {
                setDuelOutcome("defeat");
                setNotice("You have been disarmed in the duel! Practice your defense against the Dark Arts.");
              }
              return next;
            });
          }
          return Math.max(0, prevShield - damage);
        });
      }

      setDuelLog((log) => [
        {
          id: `log-${Date.now()}-${Math.random()}`,
          text: message,
          type: shield ? "shield" : "damage",
          time: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
        },
        ...log.slice(0, 18),
      ]);
    });

    s.on("game:error", ({ message }) => setNotice(message));
    s.on("net:pong", ({ sentAt }) => setRtt(Math.max(0, Date.now() - sentAt)));
    const ping = window.setInterval(() => { if (s.connected) s.emit("net:ping", { sentAt: Date.now() }); }, 3500);
    const throughput = window.setInterval(() => { setMessagesPerSecond(messageCount.current); messageCount.current = 0; }, 1000);
    const checkHealth = () => { void fetch("/ready").then((r) => r.ok ? r.json() : Promise.reject()).then((data) => setServerHealth(data.status === "ready" ? "healthy" : "degraded")).catch(() => setServerHealth("degraded")); };
    checkHealth(); const health = window.setInterval(checkHealth, 15000);
    return () => {
      alive = false; clearInterval(ping); clearInterval(throughput); clearInterval(health);
      if (geoWatch.current !== undefined && navigator.geolocation) navigator.geolocation.clearWatch(geoWatch.current);
      if (shareTimer.current) clearTimeout(shareTimer.current);
      s.disconnect(); socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, me?.id]);

  const collect = useCallback((item: Collectible) => {
    socket?.emit("item:collect", { itemId: item.id });
    setCollectibles((list) => list.filter((i) => i.id !== item.id));
    playAudioChime("snitch");
    const pts = liquidLuckActive ? item.points * 2 : item.points;
    setNotice(`✨ Gathered ${item.label}! +${pts} XP`);
    setXpToast({ amount: pts, source: item.label, totalXp: (progression?.totalXp ?? 0) + pts });
    if (progression) {
      setProgression((p) => p ? { ...p, totalXp: p.totalXp + pts } : p);
    }
  }, [socket, liquidLuckActive, progression]);

  const handleDeviceMove = useCallback((newPos: Position, distMeters: number, gpsAcc?: number) => {
    setPosition(newPos);
    posRef.current = newPos;
    lastMovedPositionRef.current = newPos;
    setDeviceLocated(true);
    if (gpsAcc !== undefined) setGpsAccuracy(gpsAcc);
    setDeviceMovementStatus("moving");
    setLastMovementMeters(Math.round(distMeters));
    setDistanceMovedTotal((prev) => prev + Math.round(distMeters));

    playAudioChime("solemn");

    const playerId = me?.id ?? "local-user";
    setTrails((old) => ({
      ...old,
      [playerId]: [...(old[playerId] ?? []), newPos].slice(-24),
    }));

    if (socketRef.current?.connected && roomRef.current) {
      seq.current += 1;
      socketRef.current.emit("player:move", { position: newPos, sequence: seq.current, timestamp: Date.now() });
    }

    // Proximity to collectibles
    collectibles.forEach((item) => {
      if (distanceMeters(newPos, item.position) <= 40) {
        collect(item);
      }
    });

    // Proximity to Golden Snitch
    if (snitch && !snitch.caughtAt && distanceMeters(newPos, snitch.position) <= 50) {
      catchSnitch(snitch.id);
    }

    // Proximity to Dementors
    const nearDementor = dementors.some((d) => distanceMeters(newPos, d.position) <= 75);
    if (nearDementor) {
      if (!dementorThreat) {
        playAudioChime("dementor");
        setDementorThreat(true);
        setNotice("❄️ The air turns bone-chilling cold! A Dementor approaches! Cast EXPECTO PATRONUM [HotKey 5]!");
      }
    } else if (dementorThreat) {
      const farEnough = dementors.every((d) => distanceMeters(newPos, d.position) > 95);
      if (farEnough) setDementorThreat(false);
    }

    // Proximity to Boggarts
    const nearBoggart = boggarts.find((b) => distanceMeters(newPos, b.position) <= 40);
    if (nearBoggart && !activeBoggart) {
      playAudioChime("alohomora");
      setActiveBoggart(nearBoggart);
    }

    // Proximity to Chocolate Frogs
    const nearFrog = chocolateFrogs.find((f) => distanceMeters(newPos, f.position) <= 35);
    if (nearFrog) {
      setChocolateFrogs((prev) => prev.filter((f) => f.id !== nearFrog.id));
      playAudioChime("snitch");
      const uncollected = FROG_CARDS.filter((c) => !collectedFrogCards.includes(c.id));
      const cardWon = uncollected.length > 0 ? uncollected[Math.floor(Math.random() * uncollected.length)] : FROG_CARDS[Math.floor(Math.random() * FROG_CARDS.length)];
      if (cardWon) {
        const updated = Array.from(new Set([...collectedFrogCards, cardWon.id]));
        setCollectedFrogCards(updated);
        localStorage.setItem("hp_frog_cards", JSON.stringify(updated));
        setNewFrogCardWon(cardWon);
        setNotice(`🐸 You caught a jumping Chocolate Frog! Unwrapped Famous Witch/Wizard: ${cardWon.name}! (+40 XP)`);
        if (progression) {
          setProgression((p) => p ? { ...p, totalXp: p.totalXp + 40 } : p);
        }
      }
    }

    if (movementResetTimer.current) clearTimeout(movementResetTimer.current);
    movementResetTimer.current = window.setTimeout(() => {
      setDeviceMovementStatus("stationary");
    }, 2800);
  }, [me?.id, collectibles, collect, snitch, dementors, dementorThreat, boggarts, activeBoggart, chocolateFrogs, collectedFrogCards, progression]);


  // ── Continuous Real-Time Device Geolocation Movement Detection ──
  useEffect(() => {
    if (!deviceTrackingActive) return;
    if (!navigator.geolocation) {
      setDeviceMovementStatus("denied");
      return;
    }

    // Minimum physical distance (meters) to count as real device movement
    // Smooth high-frequency physical device movement updates
    const MOVEMENT_THRESHOLD_METERS = 0.8;

    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const here: Position = { lat: coords.latitude, lng: coords.longitude };
        if (!Number.isFinite(here.lat) || !Number.isFinite(here.lng)) return;

        // First GPS lock on device
        if (!lastMovedPositionRef.current) {
          lastMovedPositionRef.current = here;
          setPosition(here);
          posRef.current = here;
          setDeviceLocated(true);
          setGpsAccuracy(coords.accuracy);
          setDeviceMovementStatus("stationary");
          return;
        }

        // Calculate real physical distance moved
        const dist = distanceMeters(lastMovedPositionRef.current, here);

        if (dist >= MOVEMENT_THRESHOLD_METERS) {
          // Device has physically moved in real-time!
          handleDeviceMove(here, dist, coords.accuracy);
        } else {
          setDeviceMovementStatus("stationary");
          setGpsAccuracy(coords.accuracy);
        }
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setDeviceMovementStatus("denied");
        } else {
          setDeviceMovementStatus("searching");
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [deviceTrackingActive, handleDeviceMove]);

  // Physical device motion accelerometer step detection
  useEffect(() => {
    if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) return;
    let lastStepTime = 0;
    function onMotion(e: DeviceMotionEvent) {
      const acc = e.accelerationIncludingGravity;
      if (!acc || acc.x === null || acc.y === null || acc.z === null) return;
      const mag = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);
      const now = Date.now();
      if (mag > 12.2 && now - lastStepTime > 450) {
        lastStepTime = now;
        setDeviceMovementStatus("moving");
      }
    }
    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, []);

  // Priori Incantatem Clash Loop
  useEffect(() => {
    if (!isClashing) return;
    const interval = window.setInterval(() => {
      setClashTimer((prevTime) => {
        const nextTime = Math.max(0, prevTime - 0.2);
        if (nextTime <= 0) {
          // Timer expired - determine winner based on clashTug
          setClashTug((currentTug) => {
            if (currentTug >= 50) {
              const bonusDmg = 30;
              setDuelOpponentHp((h) => {
                const nextHp = Math.max(0, h - bonusDmg);
                if (nextHp <= 0) {
                  setDuelOutcome("victory");
                  setDuelWinsCount((c) => {
                    const next = c + 1;
                    localStorage.setItem("hp_duel_wins", String(next));
                    return next;
                  });
                  playAudioChime("duel_win");
                }
                return nextHp;
              });
              setDuelOpponentStunned(true);
              playAudioChime("stupefy");
              setDuelLog((log) => [
                {
                  id: `log-${Date.now()}`,
                  text: `✨ The golden bead bursts into ${duelOpponent?.name}'s wand! The recoil blasts them for ${bonusDmg} damage!`,
                  type: "clash",
                  time: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
                },
                ...log.slice(0, 18),
              ]);
            } else {
              const recoilDmg = 20;
              setDuelPlayerHp((h) => {
                const nextHp = Math.max(0, h - recoilDmg);
                if (nextHp <= 0) setDuelOutcome("defeat");
                return nextHp;
              });
              setDuelPlayerStunned(true);
              setDuelLog((log) => [
                {
                  id: `log-${Date.now()}`,
                  text: `💥 The golden core slips back! The concussive explosion blasts you for ${recoilDmg} damage!`,
                  type: "damage",
                  time: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
                },
                ...log.slice(0, 18),
              ]);
            }
            return currentTug;
          });
          setIsClashing(false);
        }
        return nextTime;
      });

      // Tug decay from opponent resistance
      setClashTug((prevTug) => {
        const difficultyDecay = duelOpponent?.botConfig?.difficulty === "Formidable" ? 3.4 : 2.4;
        const nextTug = Math.max(0, prevTug - difficultyDecay);
        return nextTug;
      });
    }, 200);

    return () => clearInterval(interval);
  }, [isClashing, duelOpponent?.name, duelOpponent?.botConfig?.difficulty]);

  const surgeWand = useCallback(() => {
    if (!isClashing) return;
    playAudioChime("clash");
    setClashTug((prev) => {
      const next = Math.min(100, prev + 9);
      if (next >= 100) {
        setIsClashing(false);
        setDuelOpponentHp((h) => {
          const nextHp = Math.max(0, h - 35);
          if (nextHp <= 0) {
            setDuelOutcome("victory");
            setDuelWinsCount((c) => {
              const n = c + 1;
              localStorage.setItem("hp_duel_wins", String(n));
              return n;
            });
            playAudioChime("duel_win");
          }
          return nextHp;
        });
        setDuelOpponentStunned(true);
        playAudioChime("stupefy");
        setDuelLog((log) => [
          {
            id: `log-${Date.now()}`,
            text: `⚡ MAXIMUM SURGE! You force the golden bead fully into ${duelOpponent?.name}'s wand! A dazzling shockwave strikes them for 35 damage!`,
            type: "clash",
            time: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
          },
          ...log.slice(0, 18),
        ]);
      }
      return next;
    });
  }, [isClashing, duelOpponent?.name]);

  const triggerBotTurn = useCallback(() => {
    if (!duelActive || !duelOpponent || !duelOpponent.isBot || duelOutcome || isClashing) return;

    if (duelOpponentStunned) {
      setDuelOpponentStunned(false);
      setDuelLog((log) => [
        {
          id: `log-${Date.now()}`,
          text: `${duelOpponent.name} is struggling against magical binding and misses their turn!`,
          type: "stun",
          time: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
        },
        ...log.slice(0, 18),
      ]);
      return;
    }

    if (duelOpponentBurn > 0) {
      const burnDmg = 8;
      setDuelOpponentHp((h) => {
        const next = Math.max(0, h - burnDmg);
        if (next <= 0) {
          setDuelOutcome("victory");
          playAudioChime("duel_win");
        }
        return next;
      });
      setDuelOpponentBurn((b) => b - 1);
      setDuelLog((log) => [
        {
          id: `log-${Date.now()}`,
          text: `🔥 ${duelOpponent.name} suffers 8 burn damage from lingering Incendio flames!`,
          type: "burn",
          time: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
        },
        ...log.slice(0, 18),
      ]);
    }

    const bot = duelOpponent.botConfig;
    const availableSpells = bot?.spells ?? ["Expelliarmus", "Stupefy", "Protego", "Incendio"];
    let chosenSpell = availableSpells[Math.floor(Math.random() * availableSpells.length)];

    if (duelOpponentHp < 35 && availableSpells.includes("Protego") && Math.random() < 0.65) {
      chosenSpell = "Protego";
    } else if (duelOpponentHp < 45 && availableSpells.includes("Expecto Patronum") && Math.random() < 0.6) {
      chosenSpell = "Expecto Patronum";
    }

    const isShield = chosenSpell === "Protego";
    const isHeal = chosenSpell === "Expecto Patronum";
    const isPetrificus = chosenSpell === "Petrificus Totalus";
    const isSerpensortia = chosenSpell === "Serpensortia";
    const isIncendio = chosenSpell === "Incendio";

    const spellColor = isShield ? "#38bdf8"
      : isHeal ? "#e2e8f0"
      : isPetrificus ? "#a855f7"
      : isSerpensortia ? "#10b981"
      : isIncendio ? "#f97316"
      : "#dc2626";

    const spellSound: AudioChimeType = isShield ? "protego"
      : isHeal ? "patronus"
      : isPetrificus ? "snitch"
      : isIncendio || isSerpensortia ? "incendio"
      : "stupefy";

    setDuelSpellAnimation({ caster: "opponent", spell: chosenSpell, color: spellColor });
    setTimeout(() => setDuelSpellAnimation(null), 900);
    setDuelSpeechBubble({ speaker: "opponent", text: `“${chosenSpell}!”` });
    setTimeout(() => setDuelSpeechBubble(null), 2400);
    playAudioChime(spellSound);

    if (isShield) {
      setDuelOpponentShield(35);
      setDuelLog((log) => [
        {
          id: `log-${Date.now()}`,
          text: `${duelOpponent.name} raises their wand with a flourish: “Protego!” A shimmering shield forms (+35 Ward Shield)!`,
          type: "shield",
          time: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
        },
        ...log.slice(0, 18),
      ]);
    } else if (isHeal) {
      setDuelOpponentHp((h) => Math.min(100, h + 25));
      setDuelLog((log) => [
        {
          id: `log-${Date.now()}`,
          text: `✨ ${duelOpponent.name} conjures a radiant Patronus with Expecto Patronum, restoring +25 Ward HP!`,
          type: "shield",
          time: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
        },
        ...log.slice(0, 18),
      ]);
    } else {
      const difficultyBonus = bot?.difficulty === "Formidable" ? 8 : bot?.difficulty === "Master" ? 4 : 0;
      const baseDamage = isPetrificus ? 14 : isSerpensortia ? 20 : Math.floor(16 + Math.random() * 12);
      const botDamage = baseDamage + difficultyBonus;

      if (isPetrificus) {
        setDuelPlayerStunned(true);
      }

      setDuelPlayerShield((prevShield) => {
        const absorbed = Math.min(prevShield, botDamage);
        const remainder = botDamage - absorbed;
        if (remainder > 0) {
          setDuelPlayerHp((h) => {
            const nextHp = Math.max(0, h - remainder);
            if (nextHp <= 0) {
              setDuelOutcome("defeat");
              setNotice("You have been disarmed! Retreat to the Hospital Wing and practice your charms.");
            }
            return nextHp;
          });
        }
        return Math.max(0, prevShield - botDamage);
      });

      let attackMsg = `${duelOpponent.name} casts “${chosenSpell}!” A crackling magical surge strikes you for ${botDamage} damage!`;
      if (isPetrificus) {
        attackMsg += ` Your limbs snap rigid — you are bound for your next turn!`;
      } else if (isSerpensortia) {
        attackMsg = `${duelOpponent.name} casts Serpensortia! A conjured emerald serpent strikes you for ${botDamage} damage!`;
      }

      setDuelLog((log) => [
        {
          id: `log-${Date.now()}`,
          text: attackMsg,
          type: isPetrificus ? "stun" : "damage",
          time: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
        },
        ...log.slice(0, 18),
      ]);
    }
  }, [duelActive, duelOpponent, duelOutcome, isClashing, duelOpponentStunned, duelOpponentBurn, duelOpponentHp]);

  const castDuelSpell = useCallback((spell: DuelSpell) => {
    if (!duelActive || !duelOpponent || duelOutcome || isClashing) return;

    if (duelPlayerStunned) {
      playAudioChime("cooldown");
      setNotice("🗿 You are bound rigid by Petrificus Totalus and miss this turn!");
      setDuelPlayerStunned(false);
      setDuelLog((log) => [
        {
          id: `log-${Date.now()}`,
          text: `You struggle against Petrificus Totalus and cannot cast your spell!`,
          type: "stun",
          time: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
        },
        ...log.slice(0, 18),
      ]);
      if (duelOpponent.isBot) {
        setTimeout(triggerBotTurn, 650);
      }
      return;
    }

    if ((duelSpellCooldowns[spell.id] ?? 0) > 0) {
      playAudioChime("cooldown");
      setNotice(`⏳ ${spell.name} is cooling down for ${duelSpellCooldowns[spell.id]} more turn(s)!`);
      return;
    }

    setDuelSpellCooldowns((prev) => {
      const updated: Record<string, number> = {};
      Object.keys(prev).forEach((k) => {
        if (prev[k] > 0) updated[k] = prev[k] - 1;
      });
      if (spell.cooldownTurns > 0) {
        updated[spell.id] = spell.cooldownTurns;
      }
      return updated;
    });

    setDuelTurnCount((t) => t + 1);
    setDuelSpellAnimation({ caster: "player", spell: spell.name, color: spell.color });
    setTimeout(() => setDuelSpellAnimation(null), 900);
    setDuelSpeechBubble({ speaker: "player", text: `“${spell.name}!”` });
    setTimeout(() => setDuelSpeechBubble(null), 2200);
    playAudioChime(spell.sound);

    if (spell.effectType === "attack" && duelOpponentHp > 25 && duelPlayerHp > 25 && Math.random() < 0.2) {
      setIsClashing(true);
      setClashTug(50);
      setClashTimer(6);
      playAudioChime("clash");
      setDuelLog((log) => [
        {
          id: `log-${Date.now()}`,
          text: `⚡ PRIORI INCANTATEM! Your ${spell.name} collides with ${duelOpponent.name}'s curse! Twin cores lock in a blinding golden cage! SURGE YOUR WAND (TAP OR SPACEBAR)!`,
          type: "clash",
          time: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
        },
        ...log.slice(0, 18),
      ]);
      return;
    }

    let actionLog = "";
    let dmgDealt = 0;

    if (spell.effectType === "shield") {
      setDuelPlayerShield(35);
      actionLog = `You summon a shimmering silver Protego barrier (+35 Ward Shield)!`;
      setDuelLog((log) => [
        {
          id: `log-${Date.now()}`,
          text: actionLog,
          type: "shield",
          time: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
        },
        ...log.slice(0, 18),
      ]);
    } else if (spell.effectType === "heal") {
      setDuelPlayerHp((h) => Math.min(100, h + 25));
      actionLog = `You cast Expecto Patronum! A silver stag bursts forth, rallying your spirit (+25 HP)!`;
      setDuelLog((log) => [
        {
          id: `log-${Date.now()}`,
          text: actionLog,
          type: "shield",
          time: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
        },
        ...log.slice(0, 18),
      ]);
    } else {
      const minDmg = spell.damageRange[0];
      const maxDmg = spell.damageRange[1];
      dmgDealt = Math.floor(minDmg + Math.random() * (maxDmg - minDmg + 1));

      if (duelOpponentShield > 0) {
        const absorbed = Math.min(duelOpponentShield, dmgDealt);
        const leftover = dmgDealt - absorbed;
        setDuelOpponentShield((s) => Math.max(0, s - dmgDealt));
        if (leftover > 0) {
          setDuelOpponentHp((h) => Math.max(0, h - leftover));
        }
        actionLog = `Your ${spell.name} strikes ${duelOpponent.name}'s Protego shield, absorbing ${absorbed} damage!`;
      } else {
        setDuelOpponentHp((h) => Math.max(0, h - dmgDealt));
        actionLog = `You cast ${spell.name}! A dazzling jet of light hits ${duelOpponent.name} for ${dmgDealt} damage!`;
      }

      if (spell.id === "incendio") {
        setDuelOpponentBurn(2);
        actionLog += ` Lingering magical flames ignite their robes!`;
      } else if (spell.id === "petrificus") {
        setDuelOpponentStunned(true);
        actionLog += ` ${duelOpponent.name} is bound rigid as stone!`;
      } else if (spell.id === "expelliarmus" && Math.random() < 0.35) {
        setDuelOpponentStunned(true);
        actionLog += ` ${duelOpponent.name}'s wand flies from their hand! Disarmed for 1 turn!`;
      }

      setDuelLog((log) => [
        {
          id: `log-${Date.now()}`,
          text: actionLog,
          type: "damage",
          time: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
        },
        ...log.slice(0, 18),
      ]);
    }

    if (!duelOpponent.isBot && socket?.connected) {
      socket.emit("duel:action", {
        targetPlayerId: duelOpponent.id,
        spell: spell.name,
        damage: dmgDealt,
        shield: spell.effectType === "shield",
        message: actionLog,
      });
    }

    const finalOppHp = duelOpponentShield > 0 ? duelOpponentHp - Math.max(0, dmgDealt - duelOpponentShield) : duelOpponentHp - dmgDealt;
    if (finalOppHp <= 0 && spell.effectType !== "shield" && spell.effectType !== "heal") {
      setDuelOutcome("victory");
      setDuelWinsCount((c) => {
        const next = c + 1;
        localStorage.setItem("hp_duel_wins", String(next));
        return next;
      });
      playAudioChime("duel_win");
      const xpWon = duelOpponent.isBot ? 80 : 150;
      setXpToast({ amount: xpWon, source: `Dueling Club: Defeated ${duelOpponent.name}`, totalXp: (progression?.totalXp ?? 0) + xpWon });
      if (progression) {
        setProgression((p) => p ? { ...p, totalXp: p.totalXp + xpWon } : p);
      }
      setNotice(`🏆 VICTORY! You defeated ${duelOpponent.name} in the Dueling Club! +${xpWon} XP & +50 House Points!`);
      if (socket?.connected) {
        socket.emit("duel:win", { opponentName: duelOpponent.name });
      }
      return;
    }

    if (duelOpponent.isBot) {
      setTimeout(triggerBotTurn, 750);
    }
  }, [
    duelActive,
    duelOpponent,
    duelOutcome,
    isClashing,
    duelPlayerStunned,
    duelSpellCooldowns,
    duelOpponentHp,
    duelPlayerHp,
    duelOpponentShield,
    socket,
    progression,
    triggerBotTurn,
  ]);

  const startBotDuel = useCallback((bot: BotDuelist) => {
    setDuelOpponent({
      id: bot.id,
      name: bot.name,
      avatar: bot.avatar,
      house: bot.house,
      wand: bot.wand,
      isBot: true,
      botConfig: bot,
    });
    setDuelActive(true);
    setDuelPlayerHp(100);
    setDuelOpponentHp(100);
    setDuelPlayerShield(0);
    setDuelOpponentShield(0);
    setDuelPlayerStunned(false);
    setDuelOpponentStunned(false);
    setDuelPlayerBurn(0);
    setDuelOpponentBurn(0);
    setDuelSpellCooldowns({});
    setDuelTurnCount(1);
    setDuelOutcome(null);
    setIsClashing(false);
    setSelectedTab("duel");
    setPanelOpen(true);
    playAudioChime("solemn");
    setDuelLog([
      {
        id: `init-${Date.now()}-1`,
        text: `Both wizards step onto the polished mahogany platform and bow formally.`,
        type: "cast",
        time: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
      },
      {
        id: `init-${Date.now()}-2`,
        text: `${bot.name} draws their wand: ${bot.quote}`,
        type: "cast",
        time: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
      },
    ]);
  }, []);

  const startPlayerDuel = useCallback((targetPlayer: PublicPlayer) => {
    if (socket?.connected) {
      socket.emit("duel:challenge", { targetPlayerId: targetPlayer.id }, (reply) => {
        if (!reply.ok) setNotice(reply.error ?? "Could not challenge player.");
      });
    }
    setDuelOpponent({
      id: targetPlayer.id,
      name: targetPlayer.username,
      avatar: targetPlayer.avatar,
      house: targetPlayer.faction ?? "gryffindor",
      wand: "11” Ash & Dragon Heartstring",
      isBot: false,
    });
    setDuelActive(true);
    setDuelPlayerHp(100);
    setDuelOpponentHp(100);
    setDuelPlayerShield(0);
    setDuelOpponentShield(0);
    setDuelPlayerStunned(false);
    setDuelOpponentStunned(false);
    setDuelPlayerBurn(0);
    setDuelOpponentBurn(0);
    setDuelSpellCooldowns({});
    setDuelTurnCount(1);
    setDuelOutcome(null);
    setIsClashing(false);
    setSelectedTab("duel");
    setPanelOpen(true);
    playAudioChime("solemn");
    setDuelLog([
      {
        id: `init-${Date.now()}-1`,
        text: `You raise your wand against fellow wizard ${targetPlayer.username}!`,
        type: "cast",
        time: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
      },
      {
        id: `init-${Date.now()}-2`,
        text: `Dueling Club regulations active: Bow, salute, and cast with honour!`,
        type: "cast",
        time: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
      },
    ]);
    setNotice(`⚔️ Challenged ${targetPlayer.username} to a magical wand duel!`);
  }, [socket]);

  const acceptChallenge = useCallback(() => {
    if (!incomingChallenge) return;
    const { fromId, fromName, fromFaction, fromAvatar } = incomingChallenge;
    setIncomingChallenge(null);
    setDuelOpponent({
      id: fromId,
      name: fromName,
      avatar: fromAvatar ?? "🧙",
      house: fromFaction ?? "gryffindor",
      wand: "11” Ash & Dragon Heartstring",
      isBot: false,
    });
    setDuelActive(true);
    setDuelPlayerHp(100);
    setDuelOpponentHp(100);
    setDuelPlayerShield(0);
    setDuelOpponentShield(0);
    setDuelPlayerStunned(false);
    setDuelOpponentStunned(false);
    setDuelPlayerBurn(0);
    setDuelOpponentBurn(0);
    setDuelSpellCooldowns({});
    setDuelTurnCount(1);
    setDuelOutcome(null);
    setIsClashing(false);
    setSelectedTab("duel");
    setPanelOpen(true);
    playAudioChime("solemn");
    setNotice(`⚔️ Accepted duel from ${fromName}! Wands at the ready!`);
  }, [incomingChallenge]);

  const declineChallenge = useCallback(() => {
    setIncomingChallenge(null);
    setNotice("Duel invitation respectfully declined.");
  }, []);

  const resetDuel = useCallback(() => {
    setDuelActive(false);
    setDuelOpponent(null);
    setDuelOutcome(null);
    setIsClashing(false);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (isClashing && e.key === " ") {
        e.preventDefault();
        surgeWand();
        return;
      }
      if (selectedTab === "duel" && duelActive && !isClashing) {
        if (e.key === "1") castDuelSpell(DUEL_SPELLS[0]);
        else if (e.key === "2") castDuelSpell(DUEL_SPELLS[1]);
        else if (e.key === "3") castDuelSpell(DUEL_SPELLS[2]);
        else if (e.key === "4") castDuelSpell(DUEL_SPELLS[3]);
        else if (e.key === "5") castDuelSpell(DUEL_SPELLS[4]);
        else if (e.key === "6") castDuelSpell(DUEL_SPELLS[5]);
        return;
      }
      if (e.key === "1") castSpell("lumos");
      else if (e.key === "2") castSpell("cloak");
      else if (e.key === "3") castSpell("trap");
      else if (e.key === "4") castSpell("ping");
      else if (e.key === "5") castPatronus();
      else if (e.key === "6") castExpelliarmus();
      else if (e.key === "Shift") { setBroomstickActive((v) => !v); playAudioChime("broom"); }
      else if (e.key === " ") {
        if (snitch && !snitch.caughtAt && distanceMeters(position, snitch.position) <= 65) {
          catchSnitch(snitch.id);
        } else if (dementorThreat) {
          castPatronus();
        } else if (activeBoggart) {
          castRiddikulus(activeBoggart);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    isClashing,
    surgeWand,
    selectedTab,
    duelActive,
    castDuelSpell,
    castSpell,
    castPatronus,
    castExpelliarmus,
    castRiddikulus,
    snitch,
    position,
    dementorThreat,
    activeBoggart,
  ]);

  // ── Global Magical Audio Feedback for All Buttons ──────────────
  useEffect(() => {
    function handleGlobalClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest("button, [role='button'], a.tab-btn, a.dock-btn, .locate-button, .view-toggle-btn");
      if (btn) {
        // Exclude buttons that have their own dedicated magical sounds
        const isSpellBtn = btn.classList.contains("spell-btn") || Boolean(btn.closest(".spell-bar")) || Boolean(btn.closest(".duel-spell-deck"));
        const isMischiefBtn = btn.classList.contains("mischief-managed-btn") || btn.textContent?.includes("Mischief managed");
        const isSolemnBtn = btn.classList.contains("solemn-oath-button");
        if (!isSpellBtn && !isMischiefBtn && !isSolemnBtn) {
          playAudioChime("click");
        }
      }
    }
    document.addEventListener("click", handleGlobalClick, true);
    return () => document.removeEventListener("click", handleGlobalClick, true);
  }, []);

  const online = useMemo(() => players.filter((p) => p.id !== me?.id && p.visibility !== "hidden"), [players, me?.id]);
  const nearby = useMemo(() => online.filter((p) => distanceMeters(position, p.position) < 700), [online, position]);
  const playerLatency = rtt == null ? "Measuring" : rtt < 70 ? "Excellent" : rtt < 150 ? "Good" : rtt < 300 ? "Average" : "Poor";

  const startMission = (mission: Mission) => { setSelectedTab("quests"); socket?.emit("mission:start", { missionId: mission.id }); setActiveMission(mission.id); };
  const completeMission = () => activeMission && socket?.emit("mission:complete", { missionId: activeMission });

  const startLocationSharing = () => {
    if (!socket?.connected) return setNotice("Wait for the secure map connection before sharing.");
    if (!navigator.geolocation) return setNotice("This browser does not provide device location.");
    const playerId = me?.id; if (!playerId) return;
    if (geoWatch.current !== undefined) navigator.geolocation.clearWatch(geoWatch.current);
    let started = false;
    geoWatch.current = navigator.geolocation.watchPosition(({ coords }) => {
      const here = { lat: coords.latitude, lng: coords.longitude };
      if (!Number.isFinite(here.lat) || !Number.isFinite(here.lng)) return;
      setPosition(here); posRef.current = here; setDeviceLocated(true); setGpsAccuracy(coords.accuracy);
      setTrails((old) => ({ ...old, [playerId]: [...(old[playerId] ?? []), here].slice(-18) }));
      if (!started) {
        started = true; const durationMs = shareDuration * 60_000; const expiresAt = Date.now() + durationMs;
        socket.emit("player:share", { enabled: true, position: here, visibility: sharePrecision, durationMs });
        setVisibility(sharePrecision); setShareExpiresAt(expiresAt);
        shareTimer.current = window.setTimeout(() => stopLocationSharing(true), durationMs);
        setNotice(`Sharing is on for ${shareDuration} minutes. Use emergency stop at any time.`);
      } else {
        seq.current += 1; socket.emit("player:move", { position: here, sequence: seq.current, timestamp: Date.now() });
      }
    }, (error) => {
      if (started) { stopLocationSharing(false); setNotice(error.code === error.PERMISSION_DENIED ? "Location permission was revoked. Your marker is hidden." : "Location updates stopped. Your marker is hidden."); return; }
      if (geoWatch.current !== undefined) navigator.geolocation.clearWatch(geoWatch.current);
      geoWatch.current = undefined;
      setNotice(error.code === error.PERMISSION_DENIED ? "Location permission was denied. You can still explore the map without sharing." : "Your device location is unavailable right now. No location was shared.");
    }, { enableHighAccuracy: sharePrecision === "visible", maximumAge: 5000, timeout: 15000 });
  };
  const toggleRest = () => { const next: PlayerStatus = status === "resting" ? "exploring" : "resting"; setStatus(next); socket?.emit("player:status", { status: next }); };
  const toggleProximity = () => {
    if (visibility === "hidden") return setNotice("Start a temporary share before enabling proximity alerts.");
    const next = !proximityEnabled; setProximityEnabled(next); socket?.emit("player:proximity", { enabled: next, radiusMeters: proximityRadius });
  };
  const selectDestination = (where: Position) => {
    if (!socket?.connected || visibility === "hidden") { setDestinationMode(false); return setNotice("Start a temporary share before sending a destination to other sharers."); }
    socket.emit("destination:share", { position: where, label: destinationLabel.trim() || "Meet here" }, (reply) => {
      setDestinationMode(false);
      if (!reply.ok) return setNotice(reply.error ?? "Could not share that destination.");
      if (reply.destination) setDestinations((list) => [...list.filter((item) => item.ownerId !== reply.destination!.ownerId), reply.destination!]);
      setNotice("Destination shared with people who are currently sharing.");
    });
  };
  const clearDestination = (destination: SharedDestination) => { if (me && destination.ownerId === me.id) socket?.emit("destination:clear", { destinationId: destination.id }); };
  const locate = () => {
    if (!navigator.geolocation) return setNotice("This browser does not provide device location.");
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const here = { lat: coords.latitude, lng: coords.longitude };
      setPosition(here);
      posRef.current = here;
      lastMovedPositionRef.current = here;
      setDeviceLocated(true);
      setGpsAccuracy(coords.accuracy);
      setDeviceMovementStatus("stationary");
      setGpsCenterMessage(`Live GPS locked · ±${Math.round(coords.accuracy)}m · Tracking real-time movement`);
      setNotice(`Centered on real device location. Walk with your device to see footprints move in real time!`);
    }, (error) => {
      const message = error.code === error.PERMISSION_DENIED ? "Allow device location to track physical movement in real time." : "Device location is unavailable right now.";
      setGpsCenterMessage(message);
      setNotice(message);
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
  };

  const filteredQuests = useMemo(() => {
    if (questTab === "available") return quests.filter((q) => q.state === "available" || q.state === "locked");
    if (questTab === "active") return quests.filter((q) => q.state === "active");
    if (questTab === "completed") return quests.filter((q) => q.state === "completed");
    return quests;
  }, [quests, questTab]);

  // ── Marauder's Map Blank Parchment Cover Screen ──────────────
  if (!isMapRevealed) {
    return (
      <main className={`marauder-cover-shell ${isRevealing ? "ink-spreading" : ""}`}>
        <div className="parchment-vignette" />
        <div className="marauders-parchment-card">
          <div className="card-vintage-border">
            <span className="corner-flourish corner-tl">❧</span>
            <span className="corner-flourish corner-tr">☙</span>
            <span className="corner-flourish corner-bl">❧</span>
            <span className="corner-flourish corner-br">☙</span>

            <div className="marauder-seal-badge">
              <span>⚜</span>
            </div>

            <div className="marauders-dedication">
              <h2 className="marauders-names">Messrs Moony, Wormtail, Padfoot, and Prongs</h2>
              <p className="marauders-purveyors">Purveyors of Aids to Magical Mischief-Makers</p>
              <div className="marauders-ink-divider">
                <span className="ink-line" />
                <span className="ink-flourish">❦</span>
                <span className="ink-line" />
              </div>
              <p className="marauders-proud">are proud to present</p>
              <h1 className="marauders-main-title">THE MARAUDER’S MAP</h1>
              <p className="marauders-subtitle-sub">Hogwarts School of Witchcraft & Wizardry</p>
            </div>

            {/* Wand tap incantation button */}
            <div className="solemn-oath-container">
              <button
                type="button"
                className="solemn-oath-button"
                onClick={revealMap}
                disabled={isRevealing}
                title="Tap wand to reveal the enchanted map"
              >
                <span className="wand-sparkle">🪄</span>
                <span className="oath-quote">“I solemnly swear that I am up to no good.”</span>
                <span className="oath-sub">Tap with wand to unfold the map ✨</span>
              </button>
            </div>

            {/* Active player badge or guest quick play info */}
            <div className="marauder-cover-footer">
              {me ? (
                <div className="active-wizard-badge">
                  <span>Wizard in Field: <b>{me.username}</b> ({me.avatar})</span>
                  <button type="button" className="cover-signout-link" onClick={signOut}>Switch Wizard</button>
                </div>
              ) : (
                <div className="cover-guest-actions">
                  <button type="button" className="cover-quick-cast-btn" onClick={revealMap}>
                    <Zap size={15} /> Quick Cast as Guest Explorer (.io)
                  </button>
                  <div className="cover-or-row"><span>OR</span></div>
                  <button type="button" className="cover-signin-btn" onClick={() => setCustomAuthOpen(!customAuthOpen)}>
                    {customAuthOpen ? "Fold Vault Credentials" : "Sign In with Hogwarts Vault Credentials"}
                  </button>
                </div>
              )}
              <p className="marauders-motto">
                “Those who wander the secret passageways of Hogwarts shall never be lost.”
              </p>
            </div>

            {/* If user clicked custom credentials on cover */}
            {!me && customAuthOpen && (
              <form onSubmit={authenticate} className="cover-vault-form">
                <div className="vault-form-header">
                  <span>HOGWARTS VAULT ARCHIVES</span>
                  <small>Book of Admittance Registration</small>
                </div>
                <label className="vault-form-label">
                  WIZARD FIELD NAME
                  <input
                    className="vault-form-input"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. Harry Potter"
                    minLength={3}
                    maxLength={20}
                    required
                  />
                </label>
                <label className="vault-form-label">
                  SECRET CIPHER
                  <input
                    className="vault-form-input"
                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 10 characters"
                    minLength={10}
                    maxLength={72}
                    required
                  />
                </label>
                {authError && <div className="auth-error">{authError}</div>}
                <button disabled={authBusy} className="primary-cta vault-cta-btn" type="submit">
                  {authBusy ? "Verifying with Sorting Hat…" : mode === "register" ? "Inscribe Explorer into Map" : "Open Map with Vault"}
                  <ArrowUpRight size={15} />
                </button>
                <div className="vault-switch-row">
                  <span>{mode === "register" ? "Already inscribed in registry?" : "New witch or wizard?"}</span>
                  <button type="button" className="vault-switch-btn" onClick={() => setMode(mode === "register" ? "login" : "register")}>
                    {mode === "register" ? "Sign In" : "Register"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </main>
    );
  }

  // ── Auth screen (Hogwarts Book of Admittance) ───────────────
  if (!token || !me) return (
    <main className="auth-shell">
      <div className="auth-art">
        <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
        <div className="art-dot dot-a" /><div className="art-dot dot-b" />
        <div className="art-center"><span>⚜</span></div>
        <div className="art-coordinate coord-a">ASTRONOMY TOWER · 57°N</div>
        <div className="art-coordinate coord-b">THE GREAT HALL · 4°W</div>
        <div className="art-quote">“Draco Dormiens<br />Nunquam Titillandus.”</div>
        <span className="art-small">HOGWARTS SCHOOL OF WITCHCRAFT & WIZARDRY · EST. 990 A.D.</span>
      </div>
      <section className="auth-card">
        <div className="brand marauder-brand"><div className="brand-mark">⚜</div><span>THE MARAUDER’S MAP</span></div>
        <div className="auth-eyebrow">THE BOOK OF ADMITTANCE & SORTING VAULT</div>
        <h1>{mode === "register" ? "Inscribe your name in the" : "Welcome back to the"}<br /><em>{mode === "register" ? "Book of Admittance." : "Marauder’s Parchment."}</em></h1>
        <p className="auth-copy">Every corridor and secret passage of Hogwarts unfolds before you. Inscribe your wizarding alias to roam the grounds, trace fellow students with live footprints, and uncover legendary relics.</p>
        <div className="io-guest-bar">
          <button type="button" className="quick-guest-btn" onClick={quickPlayGuest} disabled={authBusy}>
            <Zap size={16} /> ⚡ Hop Aboard the Hogwarts Express (Quick Play .io)
          </button>
          <div className="io-or-line"><span>OR INSCRIBE VAULT CIPHER</span></div>
        </div>
        <form onSubmit={authenticate}>
          <label>WIZARDING ALIAS / FIELD NAME<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. Harry Potter" minLength={3} maxLength={20} required /></label>
          <label>SECRET CIPHER / INCANTATION<input autoComplete={mode === "register" ? "new-password" : "current-password"} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 10 runes" minLength={10} maxLength={72} required /></label>
          {mode === "register" && <div className="avatar-choice"><span>CHOOSE YOUR PATRONUS / WIZARD MARK</span><div>{avatars.map((item) => <button type="button" key={item} className={avatar === item ? "avatar-option selected" : "avatar-option"} onClick={() => setAvatar(item)}>{item}</button>)}</div></div>}
          {authError && <div className="auth-error">{authError}</div>}
          <button disabled={authBusy} className="primary-cta" type="submit">{authBusy ? "Consulting the Sorting Hat…" : mode === "register" ? "Inscribe Name into Book of Admittance" : "Disclose Cipher & Enter Castle"}<ArrowUpRight size={17} /></button>
        </form>
        <div className="auth-switch">{mode === "register" ? "Already inscribed in registry?" : "New witch or wizard?"} <button onClick={() => setMode(mode === "register" ? "login" : "register")}>{mode === "register" ? "Sign In" : "Inscribe Name"}</button></div>
        <div className="auth-privacy"><ShieldCheck size={14} /> Consent-based location charms protect your whereabouts at all times.</div>
      </section>
    </main>
  );

  // ── Room gate screen (Room of Requirement & Portkey Gate) ─────
  if (!room) return (
    <main className="room-gate">
      <div className="room-gate-art">
        <div className="room-gate-compass"><Compass size={36} /></div>
        <span className="room-gate-star star-one">✦</span><span className="room-gate-star star-two">✳</span>
        <span className="room-gate-note">THE ROOM OF REQUIREMENT & PORTKEY GATE</span>
      </div>
      <section className="room-gate-card">
        <div className="brand marauder-brand"><div className="brand-mark">⚜</div><span>THE MARAUDER’S MAP</span></div>
        <div className="auth-eyebrow">SUMMON YOUR HOGWARTS FELLOWSHIP</div>
        <h1>Step into the<br /><em>Secret Passageways.</em></h1>

        {/* Public Global .io Realm Shortcut */}
        <div className="realm-hero-card">
          <div className="realm-hero-tag"><Sparkles size={13} /> LIVE MULTIPLAYER CASTLE REALM</div>
          <h3>The Great Hall & Castle Grounds</h3>
          <p>Step through the Portkey to join the living Hogwarts grounds with fellow witches & wizards, House Spires to conquer, and the fluttering Golden Snitch!</p>
          <button
            type="button"
            className="realm-play-button"
            disabled={!connected}
            onClick={() => {
              socket?.emit("room:join", { code: "REALM001" }, (reply) => {
                if (!reply.ok || !reply.room) return setRoomError(reply.error ?? "Could not touch portkey.");
                enterRoom(reply.room, socket);
              });
            }}
          >
            <Zap size={16} /> ⚡ Touch Portkey to Hogwarts Realm (.io)
          </button>
        </div>

        <p className="auth-copy">Or inscribe a private Common Room chamber for your trusted circle:</p>
        <button type="button" className="room-gps-button" onClick={locate}><LocateFixed size={15} />{deviceLocated ? "GPS centered for local grounds exploration" : "Center local quests on my wand GPS"}</button>
        <small className="room-gps-note">{gpsCenterMessage || "This centers your private quest map. Fellow students cannot see your footprints until you reveal them."}</small>
        <form onSubmit={createRoom}><label>NAME YOUR COMMON ROOM CHAMBER<input value={roomName} onChange={(e) => setRoomName(e.target.value)} minLength={2} maxLength={40} required placeholder="e.g. Gryffindor Tower Fireside" /></label><button className="primary-cta" disabled={!connected} type="submit">Inscribe Secret Chamber <ArrowUpRight size={16} /></button></form>
        <div className="room-or">OR ENTER WITH AN 8-RUNE INVITE CIPHER</div>
        <form onSubmit={joinRoom}><label>8-RUNE INVITE CIPHER<input className="room-code-input" autoComplete="off" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase().replace(/[^A-F0-9]/g, "").slice(0, 8))} maxLength={8} required placeholder="e.g. A14F28C0" /></label><button className="room-join-button" disabled={!connected || roomCode.length !== 8} type="submit">Enter Common Room</button></form>
        {roomError && <div className="auth-error">{roomError}</div>}
        <div className="room-connection"><span className={connected ? "connection-dot on" : "connection-dot"} />{connected ? "Floo Network connection active" : "Connecting to Hogwarts Floo Network…"}</div>
        <div className="auth-privacy"><ShieldCheck size={14} /> Invisibility Cloak active: no one sees your footprints until you choose to reveal.</div>
      </section>
    </main>
  );


  // ── Main game view ───────────────────────────────────────────
  return (
    <main className="game-shell">
      {/* ── Mischief Managed Screen Overlay ── */}
      {isMischiefManaging && (
        <div className="mischief-managed-overlay">
          <div className="mischief-card">
            <span className="mischief-wand">✨</span>
            <h2 className="mischief-dialogue">“Mischief managed.”</h2>
            <p className="mischief-description">The ink dissolves into blank parchment...</p>
          </div>
        </div>
      )}

      <LevelUpOverlay levelUp={levelUp} onClose={() => setLevelUp(null)} />
      {/* XP toast */}
      {xpToast && (
        <div className="xp-toast">
          <Sparkles size={14} />
          <span>+{xpToast.amount} XP</span>
          <span className="xp-toast-source">{xpToast.source}</span>
        </div>
      )}
      <header className="topbar">
        <div className="brand marauder-brand">
          <div className="brand-mark">⚜</div>
          <span className="brand-title">THE MARAUDER’S MAP</span>
          <i className="brand-divider" />
          <span className="brand-sub">Hogwarts Grounds</span>
        </div>
        <div className="current-room" title={`${room.id === "REALM-GLOBAL" ? "Hogwarts Realm" : "Chamber"}: ${room.name} (${room.code})`}>
          <span>{room.id === "REALM-GLOBAL" ? "REALM" : "ROOM"}</span>
          <b>{room.name}</b>
          <code>{room.code}</code>
          <button onClick={room.ownerId === me.id && room.id !== "REALM-GLOBAL" ? endRoom : leaveRoom} title={room.ownerId === me.id ? "End room" : "Leave room"}>
            {room.ownerId === me.id && room.id !== "REALM-GLOBAL" ? "End" : "Leave"}
          </button>
        </div>
        <div className="faction-selector" title="Choose your Hogwarts House">
          <span className="faction-label">HOUSE</span>
          <div className="faction-btns">
            <button className={faction === "gryffindor" ? "active house-gryffindor" : "house-gryffindor"} onClick={() => selectFaction("gryffindor")} title="Gryffindor (Bravery & Chivalry)">🦁</button>
            <button className={faction === "slytherin" ? "active house-slytherin" : "house-slytherin"} onClick={() => selectFaction("slytherin")} title="Slytherin (Ambition & Cunning)">🐍</button>
            <button className={faction === "ravenclaw" ? "active house-ravenclaw" : "house-ravenclaw"} onClick={() => selectFaction("ravenclaw")} title="Ravenclaw (Wisdom & Wit)">🦅</button>
            <button className={faction === "hufflepuff" ? "active house-hufflepuff" : "house-hufflepuff"} onClick={() => selectFaction("hufflepuff")} title="Hufflepuff (Loyalty & Dedication)">🦡</button>
          </div>
        </div>
        <div className="top-right">
          <button
            type="button"
            className="mischief-managed-btn"
            onClick={manageMischief}
            title="Wipe the map clean and hide all traces"
          >
            <Sparkles size={14} />
            <span className="mischief-btn-text">“Mischief managed.” ✨</span>
          </button>
          <div className="live-pill"><i /> <span>{connected ? "LIVE MAP" : "RECONNECTING"}</span></div>
          <button className="profile-chip" onClick={signOut} title="Sign Out / Switch Wizard">
            <span className="profile-avatar">{me.avatar}</span>
            <span className="profile-name">{me.username}</span>
            <LogOut size={14} />
          </button>
          <button className="mobile-menu" onClick={() => { setPanelOpen(!panelOpen); setMapRefresh((n) => n + 1); }} aria-label="Toggle panel">
            {panelOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>
      <div className="game-body">
        {/* MAP */}
        <section className={`map-wrap ${panelOpen ? "" : "map-wide"}`}>
          <MapContainer center={[position.lat, position.lng]} zoom={Number(import.meta.env.VITE_MAP_ZOOM ?? 15)} zoomControl={false} className="game-map">
            <TileLayer
              key={mapLayer}
              attribution='&copy; <a href="https://www.esri.com/">Esri</a>, OpenStreetMap contributors'
              url={
                mapLayer === "topo"
                  ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
                  : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
              }
              maxZoom={19}
            />
            <MapResize refresh={mapRefresh} />
            <ZoomControl position="bottomright" />
            <MapClickAction enabled={destinationMode} onSelect={selectDestination} />
            <FollowPlayer position={position} />
            {/* Trails */}
            {players.filter((p) => p.visibility !== "hidden" && (trails[p.id]?.length ?? 0) > 1).map((p) => <Polyline key={`trail-${p.id}`} positions={trails[p.id].map((q) => [q.lat, q.lng] as [number, number])} pathOptions={{ color: "#8c633e", weight: 2.5, opacity: 0.72, dashArray: "3 7" }} />)}
            {/* Footprints with floating cursive ribbons */}
            {players.filter((p) => p.visibility !== "hidden").flatMap((p) => (trails[p.id] ?? []).slice(-6).map((step, index, arr) => <Marker key={`footsteps-${p.id}-${index}`} position={[step.lat, step.lng]} icon={footprintIcon(index, p.username, index === arr.length - 1)} interactive={false} />))}
            {visibility !== "hidden" && (trails[me.id] ?? []).slice(-6).map((step, index, arr) => <Marker key={`my-footsteps-${index}`} position={[step.lat, step.lng]} icon={footprintIcon(index, me.username, index === arr.length - 1)} interactive={false} />)}
            {/* GPS accuracy circle */}
            {deviceLocated && gpsAccuracy !== null && <Circle center={[position.lat, position.lng]} radius={Math.max(8, gpsAccuracy)} pathOptions={{ color: "#b88a46", fillColor: "#e9ca82", fillOpacity: 0.14, weight: 1, dashArray: "3 5" }} />}
            
            {/* Lumos pulse wave */}
            {lumosWave && <Circle center={[lumosWave.position.lat, lumosWave.position.lng]} radius={lumosWave.radiusM} pathOptions={{ color: "#facc15", fillColor: "#fef08a", fillOpacity: 0.22, weight: 3 }} />}
            
            {/* Radar ping vector */}
            {radarPing && <Polyline positions={[[radarPing.from.lat, radarPing.from.lng], [radarPing.target.lat, radarPing.target.lng]] as [number, number][]} pathOptions={{ color: "#38bdf8", weight: 3, dashArray: "6 6" }} />}

            {/* Spires */}
            {spires.map((spire) => {
              const factionColor = spire.controllingFaction === "gryffindor" ? "#740001"
                : spire.controllingFaction === "slytherin" ? "#1a472a"
                : spire.controllingFaction === "ravenclaw" ? "#0e1a40"
                : spire.controllingFaction === "hufflepuff" ? "#ecb939"
                : spire.controllingFaction === "phoenix" ? "#ef4444"
                : spire.controllingFaction === "serpent" ? "#10b981"
                : spire.controllingFaction === "owl" ? "#3b82f6"
                : "#a88449";
              return (
                <div key={spire.id}>
                  <Circle center={[spire.position.lat, spire.position.lng]} radius={spire.radiusM} pathOptions={{ color: factionColor, fillColor: factionColor, fillOpacity: 0.16, weight: 2, dashArray: "4 6" }} />
                  <Marker position={[spire.position.lat, spire.position.lng]} icon={spireIcon(spire.controllingFaction)}>
                    <Popup>
                      <div className="spire-popup">
                        <b>{spire.name}</b>
                        <div>House: <em style={{ color: factionColor, fontWeight: 600 }}>{spire.controllingFaction.toUpperCase()}</em></div>
                        <div>Capture Progress: {spire.captureProgress}%</div>
                        <small>Stand within {spire.radiusM}m to channel capture for your house!</small>
                      </div>
                    </Popup>
                  </Marker>
                </div>
              );
            })}

            {/* Golden Snitch */}
            {snitch && !snitch.caughtAt && (
              <Marker position={[snitch.position.lat, snitch.position.lng]} icon={snitchIcon()} eventHandlers={{ click: () => catchSnitch(snitch.id) }}>
                <Popup>
                  <div className="snitch-popup">
                    <b>✨ The Golden Snitch</b>
                    <div>Jackpot: +{snitch.points} XP!</div>
                    <button className="popup-catch-btn" onClick={() => catchSnitch(snitch.id)}>Catch the Snitch</button>
                  </div>
                </Popup>
              </Marker>
            )}

            {/* Rune Traps */}
            {traps.map((trap) => (
              <Marker key={trap.id} position={[trap.position.lat, trap.position.lng]} icon={trapIcon(trap.ownerId === me.id)}>
                <Popup><b>⚡ Rune Trap</b><br />Placed by {trap.ownerName}</Popup>
              </Marker>
            ))}

            {/* Crowned Marauders */}
            {players.filter((p) => p.isCrowned && p.visibility !== "hidden").map((p) => (
              <Marker key={`crown-${p.id}`} position={[p.position.lat, p.position.lng]} icon={crownIcon()} eventHandlers={{ click: () => tagCrown(p.id) }}>
                <Popup><b>👑 Crowned Marauder</b><br />{p.username}<br /><button className="popup-tag-btn" onClick={() => tagCrown(p.id)}>Tag for +75 XP Bounty</button></Popup>
              </Marker>
            ))}

            {/* My marker */}
            <Marker key="local-player" position={[position.lat, position.lng]} icon={avatarIcon(me.avatar, true)}>
              <Popup>You · {deviceLocated ? `GPS · ±${Math.round(gpsAccuracy ?? 0)} m` : "map center"} · House {faction.toUpperCase()}</Popup>
            </Marker>
            {/* Other players */}
            {players.filter((p) => p.id !== me.id && p.visibility !== "hidden" && !p.isCloaked).map((p) => (
              <Marker key={p.id} position={[p.position.lat, p.position.lng]} icon={avatarIcon(p.avatar)}>
                <Popup>
                  <div><b>{p.username}</b> {p.faction && <span>(House {p.faction.toUpperCase()})</span>}</div>
                  {p.isCrowned && <button className="popup-tag-btn" onClick={() => tagCrown(p.id)}>Tag Bounty (+75 XP)</button>}
                </Popup>
              </Marker>
            ))}
            {/* Destination routes */}
            {deviceLocated && destinations.map((destination) => <Polyline key={`destination-route-${destination.id}`} positions={[[position.lat, position.lng], [destination.position.lat, destination.position.lng]] as [number, number][]} pathOptions={{ color: "#b78843", weight: 2.5, opacity: 0.82, dashArray: "8 8" }} />)}
            {/* Destination markers */}
            {destinations.map((destination) => <Marker key={destination.id} position={[destination.position.lat, destination.position.lng]} icon={itemIcon(true)} eventHandlers={{ click: () => clearDestination(destination) }}><Popup>{destination.label} · {destination.ownerName}</Popup></Marker>)}
            {/* Collectibles */}
            {collectibles.map((item) => <Marker key={item.id} position={[item.position.lat, item.position.lng]} icon={itemIcon(item.kind === "relic")} eventHandlers={{ click: () => collect(item) }} />)}
            {/* Mission circles */}
            {missions.map((mission) => <Circle key={mission.id} center={[mission.target.lat, mission.target.lng]} radius={mission.radiusM} pathOptions={{ color: activeMission === mission.id ? "#c4714c" : "#6c8974", fillColor: activeMission === mission.id ? "#dc9770" : "#89a992", fillOpacity: 0.12, weight: 1, dashArray: "4 7" }} />)}

            {/* Patronus silver pulse wave */}
            {patronusWave && (
              <Circle center={[patronusWave.position.lat, patronusWave.position.lng]} radius={patronusWave.radiusM} pathOptions={{ color: "#e0f2fe", fillColor: "#bae6fd", fillOpacity: 0.35, weight: 4 }} />
            )}

            {/* Dementors */}
            {dementors.map((dem) => (
              <Marker key={dem.id} position={[dem.position.lat, dem.position.lng]} icon={dementorIcon()} eventHandlers={{ click: castPatronus }}>
                <Popup>
                  <div className="dementor-popup">
                    <b>👻 {dem.name}</b>
                    <p>Cast <em>Expecto Patronum</em> to banish this soul-draining specter!</p>
                    <button className="popup-catch-btn" onClick={castPatronus}>Expecto Patronum! 🦌</button>
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* Boggarts in Rattling Wardrobes */}
            {boggarts.map((bog) => (
              <Marker key={bog.id} position={[bog.position.lat, bog.position.lng]} icon={boggartIcon()} eventHandlers={{ click: () => setActiveBoggart(bog) }}>
                <Popup>
                  <div className="boggart-popup">
                    <b>📦 {bog.name}</b>
                    <p>Rattling mysteriously! Approach or click to confront your fear.</p>
                    <button className="popup-tag-btn" onClick={() => setActiveBoggart(bog)}>Open Wardrobe 🗝️</button>
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* Chocolate Frogs */}
            {chocolateFrogs.map((frog) => (
              <Marker key={frog.id} position={[frog.position.lat, frog.position.lng]} icon={frogIcon()} eventHandlers={{ click: () => {
                setChocolateFrogs((prev) => prev.filter((f) => f.id !== frog.id));
                playAudioChime("snitch");
                const uncollected = FROG_CARDS.filter((c) => !collectedFrogCards.includes(c.id));
                const cardWon = uncollected.length > 0 ? uncollected[Math.floor(Math.random() * uncollected.length)] : FROG_CARDS[Math.floor(Math.random() * FROG_CARDS.length)];
                if (cardWon) {
                  const updated = Array.from(new Set([...collectedFrogCards, cardWon.id]));
                  setCollectedFrogCards(updated);
                  localStorage.setItem("hp_frog_cards", JSON.stringify(updated));
                  setNewFrogCardWon(cardWon);
                  setNotice(`🐸 You caught a jumping Chocolate Frog! Unwrapped Famous Witch/Wizard: ${cardWon.name}! (+40 XP)`);
                  if (progression) {
                    setProgression((p) => p ? { ...p, totalXp: p.totalXp + 40 } : p);
                  }
                }
              }}}>
                <Popup>
                  <div className="frog-popup">
                    <b>🐸 Jumping Chocolate Frog</b>
                    <p>Catch it to unwrap a collectible holographic Famous Witch/Wizard card!</p>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>

          {/* Nimbus 2000 Broomstick Flight HUD Pill */}
          {broomstickActive && (
            <div className="broom-hud-pill">
              <span className="broom-icon">🧹</span>
              <span className="broom-text">Nimbus 2000 Flight Active (3.5x Speed)</span>
              <button type="button" className="broom-dismount-btn" onClick={() => setBroomstickActive(false)}>Dismount (Shift)</button>
            </div>
          )}

          {/* Real-time Physical GPS Movement Controller */}
          <div className="live-gps-dock">
            <div className="gps-dock-header">
              <span className={`gps-pulse-beacon ${deviceMovementStatus === "moving" ? "beacon-moving" : deviceMovementStatus === "stationary" ? "beacon-stationary" : "beacon-searching"}`} />
              <span className="gps-dock-title">LIVE REAL-TIME GPS MOVEMENT</span>
              <span className={`gps-live-badge status-${deviceMovementStatus}`}>
                {deviceMovementStatus === "moving"
                  ? `🏃 MOVING (+${lastMovementMeters}m)`
                  : deviceMovementStatus === "stationary"
                  ? "⏸️ STATIONARY"
                  : deviceMovementStatus === "denied"
                  ? "🚫 GPS OFF"
                  : "🛰️ LOCKING GPS"}
              </span>
            </div>
            <div className="gps-telemetry-row">
              <div className="gps-telemetry-col">
                <span className="gps-telemetry-label">POSITION</span>
                <span className="gps-telemetry-val">
                  {Math.abs(position.lat).toFixed(4)}° {position.lat >= 0 ? "N" : "S"}, {Math.abs(position.lng).toFixed(4)}° {position.lng >= 0 ? "E" : "W"}
                </span>
              </div>
              <div className="gps-telemetry-col">
                <span className="gps-telemetry-label">PRECISION</span>
                <span className="gps-telemetry-val">
                  {gpsAccuracy !== null ? `±${Math.round(gpsAccuracy)}m` : "Acquiring"}
                </span>
              </div>
              <div className="gps-telemetry-col">
                <span className="gps-telemetry-label">WALKED</span>
                <span className="gps-telemetry-val">{distanceMovedTotal}m</span>
              </div>
            </div>
            <div className="gps-action-row">
              <button
                type="button"
                className="gps-recenter-btn"
                onClick={locate}
                title="Pan map directly to your live physical device location"
              >
                <LocateFixed size={14} /> <span>Recenter on Me</span>
              </button>
              <button
                type="button"
                className={`gps-tracking-pill ${deviceTrackingActive ? "active" : ""}`}
                onClick={() => setDeviceTrackingActive((v) => !v)}
                title="Toggle real-time background physical movement tracking"
              >
                {deviceTrackingActive ? "🛰️ GPS: Active" : "⏸️ GPS: Paused"}
              </button>
            </div>
          </div>

          {/* Spell Action Quick-Bar */}
          <div className="spell-bar">
            <button
              type="button"
              className={`spell-btn ${cooldowns.lumos > Date.now() ? "cooldown" : ""}`}
              onClick={() => castSpell("lumos")}
              title="Lumos: Illuminate hidden relics and players within 350m [Hotkey 1]"
            >
              <span className="spell-key">1</span>
              <span className="spell-icon">✨</span>
              <span className="spell-label">Lumos</span>
              {cooldowns.lumos > Date.now() && <span className="spell-cd">{Math.ceil((cooldowns.lumos - Date.now()) / 1000)}s</span>}
            </button>
            <button
              type="button"
              className={`spell-btn ${cooldowns.cloak > Date.now() ? "cooldown" : ""} ${isCloaked ? "active-spell" : ""}`}
              onClick={() => castSpell("cloak")}
              title="Invisibility Cloak: Hide footsteps and marker for 15s [Hotkey 2]"
            >
              <span className="spell-key">2</span>
              <span className="spell-icon">👤</span>
              <span className="spell-label">Cloak</span>
              {cooldowns.cloak > Date.now() && <span className="spell-cd">{Math.ceil((cooldowns.cloak - Date.now()) / 1000)}s</span>}
            </button>
            <button
              type="button"
              className={`spell-btn ${cooldowns.trap > Date.now() ? "cooldown" : ""}`}
              onClick={() => castSpell("trap")}
              title="Rune Trap: Plant an arcane snare (+50 XP when triggered) [Hotkey 3]"
            >
              <span className="spell-key">3</span>
              <span className="spell-icon">⚡</span>
              <span className="spell-label">Trap</span>
              {cooldowns.trap > Date.now() && <span className="spell-cd">{Math.ceil((cooldowns.trap - Date.now()) / 1000)}s</span>}
            </button>
            <button
              type="button"
              className={`spell-btn ${cooldowns.ping > Date.now() ? "cooldown" : ""}`}
              onClick={() => castSpell("ping")}
              title="Marauder Radar: Point vector towards nearest Snitch or Spire [Hotkey 4]"
            >
              <span className="spell-key">4</span>
              <span className="spell-icon">🧭</span>
              <span className="spell-label">Radar</span>
              {cooldowns.ping > Date.now() && <span className="spell-cd">{Math.ceil((cooldowns.ping - Date.now()) / 1000)}s</span>}
            </button>
            <button
              type="button"
              className="spell-btn spell-patronus"
              onClick={castPatronus}
              title="Expecto Patronum: Banish Dementors within 260m [Hotkey 5]"
            >
              <span className="spell-key">5</span>
              <span className="spell-icon">🦌</span>
              <span className="spell-label">Patronus</span>
            </button>
            <button
              type="button"
              className="spell-btn spell-expelliarmus"
              onClick={castExpelliarmus}
              title="Expelliarmus: Disarming Dueling Bolt [Hotkey 6]"
            >
              <span className="spell-key">6</span>
              <span className="spell-icon">⚡</span>
              <span className="spell-label">Expelliarmus</span>
            </button>
          </div>

          {/* Dementor Creeping Frost Overlay */}
          {dementorThreat && (
            <div className="dementor-frost-overlay">
              <div className="dementor-alert-banner">
                <span className="dementor-skull">❄️ 👻 ❄️</span>
                <h3>A Dementor Approaches!</h3>
                <p>The air freezes solid and despair creeps into your soul! Summon your happiest memory!</p>
                <button type="button" className="patronus-cast-button" onClick={castPatronus}>
                  EXPECTO PATRONUM! 🦌 (Press 5 / Space)
                </button>
              </div>
            </div>
          )}

          {/* Boggart Rattling Wardrobe Modal */}
          {activeBoggart && (
            <div className="snitch-catch-modal">
              <div className="snitch-celebration-card boggart-card">
                <span className="snitch-big-icon">📦💥</span>
                <h2 className="snitch-celebration-title">A Boggart rattles within!</h2>
                <p className="snitch-celebration-subtitle">“It takes the shape of whatever it thinks will frighten us most...”</p>
                <div className="boggart-fear-reveal">
                  <span>😱 Manifestation:</span>
                  <b>{activeBoggart.fear}</b>
                </div>
                <p className="boggart-hint">Picture it in your mind becoming utterly absurd, and shout:</p>
                <button type="button" className="snitch-dismiss-btn riddikulus-btn" onClick={() => castRiddikulus(activeBoggart)}>
                  🪄 “RIDDIKULUS!” (Turn Ridiculous +50 XP)
                </button>
                <button type="button" className="boggart-flee-btn" onClick={() => setActiveBoggart(null)}>
                  Back Away Slowly
                </button>
              </div>
            </div>
          )}

          {/* Snitch Catch Celebration Modal */}
          {snitchCelebration && (
            <div className="snitch-catch-modal">
              <div className="snitch-celebration-card">
                <div className="snitch-confetti-particle" style={{ left: "15%", top: "10%" }}>✨</div>
                <div className="snitch-confetti-particle" style={{ left: "80%", top: "15%" }}>✨</div>
                <div className="snitch-confetti-particle" style={{ left: "30%", top: "75%" }}>🌟</div>
                <div className="snitch-confetti-particle" style={{ left: "70%", top: "70%" }}>🌟</div>
                <span className="snitch-big-icon">⚚</span>
                <h2 className="snitch-celebration-title">150 POINTS TO {faction.toUpperCase()}!</h2>
                <p className="snitch-celebration-subtitle">You caught the elusive Golden Snitch in mid-air!</p>
                <div className="snitch-xp-reward-box">
                  <span>+{snitchCelebration.points} XP JACKPOT</span>
                  <small>House Cup hourglass fills with glittering jewels</small>
                </div>
                <button type="button" className="snitch-dismiss-btn" onClick={() => setSnitchCelebration(null)}>
                  Carry on Wandering the Grounds ✨
                </button>
              </div>
            </div>
          )}

          {/* Sorting Hat Ceremony Modal */}
          {sortingHatOpen && (
            <div className="sorting-hat-modal">
              <div className="sorting-hat-card">
                <span className="sorting-hat-avatar">🎩</span>
                <h3 className="sorting-hat-title">The Sorting Hat Ceremony</h3>
                <p className="sorting-hat-speech">
                  {sortingThinking
                    ? "“Hmm... difficult. Very difficult. Plenty of courage, I see... Not a bad mind, either. There’s talent, oh yes... and a thirst to prove yourself... Where shall I put you?”"
                    : `“Answer true, young wanderer: Question ${sortingQuestionIndex + 1} of ${SORTING_QUESTIONS.length}...”`}
                </p>
                {!sortingThinking && (
                  <div className="sorting-options-list">
                    <p className="sorting-q-text">{SORTING_QUESTIONS[sortingQuestionIndex].question}</p>
                    {SORTING_QUESTIONS[sortingQuestionIndex].options.map((opt, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="sorting-opt-btn"
                        onClick={() => answerSortingQuestion(opt.house)}
                      >
                        <span className="sorting-opt-letter">{["A", "B", "C", "D"][idx]}</span>
                        <span>{opt.text}</span>
                      </button>
                    ))}
                  </div>
                )}
                <button type="button" className="sorting-close-btn" onClick={() => setSortingHatOpen(false)}>
                  Cancel Ceremony
                </button>
              </div>
            </div>
          )}

          {/* New Chocolate Frog Card Won Popup */}
          {newFrogCardWon && (
            <div className="snitch-catch-modal">
              <div className="snitch-celebration-card card-won-card">
                <span className="snitch-big-icon">🐸✨</span>
                <h2 className="snitch-celebration-title">FAMOUS WITCH OR WIZARD!</h2>
                <p className="snitch-celebration-subtitle">Unwrapped from a jumping Chocolate Frog:</p>
                <div className="frog-card-won-preview">
                  <span className="frog-card-won-emoji">{newFrogCardWon.emoji}</span>
                  <h3 className="frog-card-won-name">{newFrogCardWon.name}</h3>
                  <span className="frog-card-won-era">{newFrogCardWon.era}</span>
                  <p className="frog-card-won-blurb">{newFrogCardWon.blurb}</p>
                </div>
                <button
                  type="button"
                  className="snitch-dismiss-btn"
                  onClick={() => {
                    setNewFrogCardWon(null);
                    setSelectedTab("cards");
                  }}
                >
                  Place in Frog Card Album 📜
                </button>
              </div>
            </div>
          )}

          {/* Inspect Card Modal */}
          {inspectedCard && (
            <div className="snitch-catch-modal">
              <div className="snitch-celebration-card card-won-card">
                <span className="snitch-big-icon">{inspectedCard.emoji}</span>
                <h2 className="snitch-celebration-title">{inspectedCard.name}</h2>
                <span className="frog-card-won-era">{inspectedCard.era}</span>
                <p className="frog-card-won-blurb" style={{ margin: "14px 0", fontSize: 13, lineHeight: 1.6 }}>{inspectedCard.blurb}</p>
                <button type="button" className="snitch-dismiss-btn" onClick={() => setInspectedCard(null)}>
                  Close Card
                </button>
              </div>
            </div>
          )}

          {/* Live Game Event Feed */}
          {feed.length > 0 && (
            <div className="game-feed">
              <div className="game-feed-header"><Sparkles size={11} /> REALM TICKER</div>
              <div className="game-feed-items">
                {feed.slice(-4).map((item) => (
                  <div key={item.id} className={`feed-item feed-${item.kind}`}>
                    {item.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Map Top Overlays & View Clarity Switcher */}
          <div className={`map-top-chip ${deviceLocated ? "gps-found" : ""}`}>
            <span className="map-sun">✦</span>
            <div><b>{deviceLocated ? "REAL DEVICE GPS" : "ENCHANTED FIELD MAP"}</b><small>{deviceLocated ? `${Math.abs(position.lat).toFixed(4)}° ${position.lat < 0 ? "S" : "N"} · ${Math.abs(position.lng).toFixed(4)}° ${position.lng < 0 ? "W" : "E"}${gpsAccuracy !== null ? ` · ±${Math.round(gpsAccuracy)} M` : ""}` : "FIND ME TO CENTER ON YOUR LOCATION"}</small></div>
          </div>

          <div className="map-view-switcher" title="Switch Map Clarity & Surroundings Style">
            <button
              type="button"
              className={`view-toggle-btn ${mapLayer === "street" ? "active" : ""}`}
              onClick={() => setMapLayer("street")}
              title="Parchment Street Map (High clarity roads, districts & surroundings)"
            >
              📜 Living Parchment
            </button>
            <button
              type="button"
              className={`view-toggle-btn ${mapLayer === "topo" ? "active" : ""}`}
              onClick={() => setMapLayer("topo")}
              title="Topographic Terrain & Elevation Map"
            >
              ⛰️ Topographic
            </button>
          </div>

          <div className="map-compass" aria-label="Compass points north"><span>N</span><Compass size={28} /><i>✦</i></div>
          <button className="locate-button" onClick={locate}><LocateFixed size={17} /><span>{deviceLocated ? "Center on me" : "Find my location"}</span></button>
          <div className="map-hint"><span className="hint-cursor">✦</span> {visibility === "hidden" ? deviceLocated ? "Your real location is private on this map" : "Find your real location · sharing remains off" : "Your location is live with this private room"}</div>
        </section>

        {/* SIDE PANEL (MARAUDER'S FIELD PARCHMENT) */}
        <aside className={`side-panel ${panelOpen ? "panel-open" : "panel-closed"}`}>
          {/* Mobile Sheet Handle & Dismiss Bar */}
          <div className="mobile-sheet-bar">
            <div className="mobile-sheet-pill" />
            <div className="mobile-sheet-nav">
              <span className="mobile-sheet-title">📜 MARAUDER’S CODEX</span>
              <button
                type="button"
                className="mobile-sheet-close-btn"
                onClick={() => {
                  setPanelOpen(false);
                  setMapRefresh((n) => n + 1);
                }}
              >
                <X size={14} /> <span>Back to Map</span>
              </button>
            </div>
          </div>
          {/* Header block with Hogwarts House Crest Banner */}
          <div className="welcome-block">
            {(() => {
              const activeHouse = HOUSE_DATA[faction] ?? HOUSE_DATA.gryffindor;
              return (
                <div className={`house-crest-banner banner-${faction}`}>
                  <div className="crest-top-row">
                    <div className="crest-shield">{activeHouse.emoji}</div>
                    <div className="crest-text-col">
                      <div className="crest-house-title">
                        <span className="crest-house-name">House {activeHouse.name}</span>
                        <span className="crest-rank-tag">Year {progression?.currentLevel ?? 1}</span>
                      </div>
                      <div className="crest-motto">{activeHouse.motto}</div>
                      <div className="crest-patronus-row">
                        <span className="crest-wizard-alias">{activeHouse.title} {me.username}</span>
                        <span className="crest-patronus-tag">🦌 {activeHouse.patronus}</span>
                      </div>
                    </div>
                  </div>
                  <div className="house-switcher-mini">
                    <div className="house-switcher-bar">
                      <span className="house-switcher-kicker">SORT INTO HOUSE</span>
                      <button
                        type="button"
                        className="sorting-hat-trigger-btn"
                        onClick={() => { setSortingQuestionIndex(0); setSortingHatOpen(true); }}
                        title="Put on the Sorting Hat for an authentic ceremony"
                      >
                        <span className="hat-emoji">🎩</span>
                        <span>Ceremony</span>
                      </button>
                    </div>
                    <div className="house-mini-grid">
                      <button type="button" className={`house-mini-card ${faction === "gryffindor" ? "active" : ""}`} onClick={() => selectFaction("gryffindor")} title="Gryffindor (Bravery & Chivalry)">
                        <span className="house-card-emoji">🦁</span>
                        <span className="house-card-label">Gryffindor</span>
                      </button>
                      <button type="button" className={`house-mini-card ${faction === "slytherin" ? "active" : ""}`} onClick={() => selectFaction("slytherin")} title="Slytherin (Ambition & Cunning)">
                        <span className="house-card-emoji">🐍</span>
                        <span className="house-card-label">Slytherin</span>
                      </button>
                      <button type="button" className={`house-mini-card ${faction === "ravenclaw" ? "active" : ""}`} onClick={() => selectFaction("ravenclaw")} title="Ravenclaw (Wisdom & Wit)">
                        <span className="house-card-emoji">🦅</span>
                        <span className="house-card-label">Ravenclaw</span>
                      </button>
                      <button type="button" className={`house-mini-card ${faction === "hufflepuff" ? "active" : ""}`} onClick={() => selectFaction("hufflepuff")} title="Hufflepuff (Loyalty & Dedication)">
                        <span className="house-card-emoji">🦡</span>
                        <span className="house-card-label">Hufflepuff</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            <XpBar progression={progression} />
          </div>

          {/* Quick Arcane Status Bar */}
          <div className="arcane-status-bar">
            <div className="status-item"><span className={connected ? "connection-dot on" : "connection-dot"} /><span>{connected ? "Floo Online" : "Reconnecting"}</span></div>
            <div className="status-item"><Users size={11} /><span>{online.length + 1} Wizards</span></div>
            <div className="status-item"><Activity size={11} /><span>{rtt == null ? "—" : `${rtt}ms (${playerLatency})`}</span></div>
            <div className="status-item daily-tracker-pill" onClick={() => setSelectedTab("discover")} title="Open Daily Prophet in Grounds">
              <Sparkles size={10} />
              <span>{[dailyMischief.lumos, dailyMischief.snitch, dailyMischief.trap, dailyMischief.spire].filter(Boolean).length}/4 Managed</span>
            </div>
          </div>

          {/* Hogwarts Chapter Index (Navigation tabs) */}
          <nav className="tabs-grid">
            <button className={`tab-btn ${selectedTab === "discover" ? "active" : ""}`} onClick={() => setSelectedTab("discover")} title="Castle Grounds"><Compass size={13} /><span>Grounds</span></button>
            <button className={`tab-btn ${selectedTab === "quests" ? "active" : ""}`} onClick={() => { setSelectedTab("quests"); void loadQuests(); }} title="Spellbound Quests"><Flag size={13} /><span>Quests</span>{quests.filter((q) => q.state === "active").length > 0 && <span className="tab-badge">{quests.filter((q) => q.state === "active").length}</span>}</button>
            <button className={`tab-btn ${selectedTab === "potions" ? "active" : ""}`} onClick={() => setSelectedTab("potions")} title="The Potions Cauldron"><span>🧪</span><span>Potions</span></button>
            <button className={`tab-btn ${selectedTab === "cards" ? "active" : ""}`} onClick={() => setSelectedTab("cards")} title="Chocolate Frog Cards"><span>🐸</span><span>Cards</span><span className="tab-badge">{collectedFrogCards.length}</span></button>
            <button className={`tab-btn ${selectedTab === "artifacts" ? "active" : ""}`} onClick={() => { setSelectedTab("artifacts"); void loadArtifacts(); }} title="Hogwarts Reliquary"><Package size={13} /><span>Relics</span></button>
            <button className={`tab-btn ${selectedTab === "achievements" ? "active" : ""}`} onClick={() => { setSelectedTab("achievements"); void loadAchievements(); }} title="Order of Merlin Honors"><Award size={13} /><span>Accolades</span></button>
            <button className={`tab-btn ${selectedTab === "players" ? "active" : ""}`} onClick={() => setSelectedTab("players")} title="Fellow Wanderers"><Radio size={13} /><span>Fellows</span></button>
            <button className={`tab-btn ${selectedTab === "friends" ? "active" : ""}`} onClick={() => { setSelectedTab("friends"); void refreshSocial(); }} title="Owl Post & Kin"><Users size={13} /><span>Owl Post</span>{(incomingRequests.length > 0) && <span className="tab-badge">{incomingRequests.length}</span>}</button>
            <button className={`tab-btn tab-btn-cup ${selectedTab === "leaderboard" ? "active" : ""}`} onClick={() => { setSelectedTab("leaderboard"); void loadLeaderboard(); }} title="The Great Hall House Cup"><Trophy size={13} /><span>House Cup</span></button>
            <button className={`tab-btn tab-btn-duel ${selectedTab === "duel" ? "active" : ""}`} onClick={() => setSelectedTab("duel")} title="Hogwarts Dueling Club"><span>⚔️</span><span>Duel</span>{duelActive && <span className="tab-badge">VS</span>}</button>
          </nav>

          {/* Panel content */}
          <div className="panel-content">
            {/* DISCOVER TAB */}
            {selectedTab === "discover" && (
              <>
                {/* The Daily Prophet: Special Marauder's Edition */}
                <div className="daily-prophet-card">
                  <div className="prophet-masthead">
                    <h4 className="prophet-title">THE DAILY PROPHET</h4>
                    <div className="prophet-edition-meta">
                      <span>NO. 394 · {fieldDate}</span>
                      <span>PRICE: 5 KNUTS</span>
                    </div>
                  </div>
                  <div className="prophet-headline">
                    “Mysterious Arcane Footprints Reported Across Castle Grounds”
                  </div>
                  <div className="prophet-tasks-list">
                    <div className={`prophet-task-item ${dailyMischief.lumos ? "task-done" : ""}`}>
                      <div className="prophet-task-info">
                        <span>{dailyMischief.lumos ? "✔" : "🕯️"}</span>
                        <span>Cast Lumos Solarem</span>
                        <span className="prophet-task-xp">+30 XP</span>
                      </div>
                      <button type="button" className="prophet-task-btn" onClick={() => castSpell("lumos")} disabled={cooldowns.lumos > Date.now()}>
                        {dailyMischief.lumos ? "Cast Again" : "Cast"}
                      </button>
                    </div>
                    <div className={`prophet-task-item ${dailyMischief.snitch ? "task-done" : ""}`}>
                      <div className="prophet-task-info">
                        <span>{dailyMischief.snitch ? "✔" : "⚚"}</span>
                        <span>Seek Golden Snitch (Radar)</span>
                        <span className="prophet-task-xp">+30 XP</span>
                      </div>
                      <button type="button" className="prophet-task-btn" onClick={() => castSpell("ping")} disabled={cooldowns.ping > Date.now()}>
                        {dailyMischief.snitch ? "Scanned" : "Scan"}
                      </button>
                    </div>
                    <div className={`prophet-task-item ${dailyMischief.trap ? "task-done" : ""}`}>
                      <div className="prophet-task-info">
                        <span>{dailyMischief.trap ? "✔" : "⚡"}</span>
                        <span>Inscribe Arcane Rune Trap</span>
                        <span className="prophet-task-xp">+30 XP</span>
                      </div>
                      <button type="button" className="prophet-task-btn" onClick={() => castSpell("trap")} disabled={cooldowns.trap > Date.now()}>
                        {dailyMischief.trap ? "Planted" : "Plant"}
                      </button>
                    </div>
                    <div className={`prophet-task-item ${dailyMischief.spire ? "task-done" : ""}`}>
                      <div className="prophet-task-info">
                        <span>{dailyMischief.spire ? "✔" : "🏰"}</span>
                        <span>Pledge House Loyalty</span>
                        <span className="prophet-task-xp">+30 XP</span>
                      </div>
                      <button type="button" className="prophet-task-btn" onClick={() => { playAudioChime("solemn"); setDailyMischief((d) => ({ ...d, spire: true })); setNotice("🦁 House loyalty reaffirmed with the Sorting Hat! +30 XP"); }}>
                        {dailyMischief.spire ? "Sworn" : "Pledge"}
                      </button>
                    </div>
                  </div>
                  {dailyMischief.lumos && dailyMischief.snitch && dailyMischief.trap && dailyMischief.spire && (
                    <div className="prophet-all-managed-banner">
                      <Sparkles size={13} />
                      <span>All Daily Mischief Managed! +120 Bonus XP Granted!</span>
                    </div>
                  )}
                </div>

                {/* Hogwarts Wand Mastery Grimoire Deck */}
                <div className="grimoire-tray">
                  <div className="grimoire-header">
                    <div className="grimoire-title">
                      <span>🪄</span> HOGWARTS SPELLBOOK
                    </div>
                    <span className="grimoire-hotkey-hint">HOTKEYS [1-4]</span>
                  </div>
                  <div className="grimoire-grid">
                    <button type="button" className={`grimoire-card ${cooldowns.lumos > Date.now() ? "on-cooldown" : ""}`} onClick={() => castSpell("lumos")}>
                      <div className="grimoire-card-top">
                        <span className="grimoire-card-name">✨ Lumos</span>
                        <span className="grimoire-card-key">1</span>
                      </div>
                      <div className="grimoire-card-desc">Illuminate 350m radius</div>
                      {cooldowns.lumos > Date.now() && <span className="grimoire-cd-badge">{Math.ceil((cooldowns.lumos - Date.now()) / 1000)}s</span>}
                    </button>
                    <button type="button" className={`grimoire-card ${cooldowns.cloak > Date.now() ? "on-cooldown" : ""}`} onClick={() => castSpell("cloak")}>
                      <div className="grimoire-card-top">
                        <span className="grimoire-card-name">👤 Cloak</span>
                        <span className="grimoire-card-key">2</span>
                      </div>
                      <div className="grimoire-card-desc">Conceal steps (15s)</div>
                      {cooldowns.cloak > Date.now() && <span className="grimoire-cd-badge">{Math.ceil((cooldowns.cloak - Date.now()) / 1000)}s</span>}
                    </button>
                    <button type="button" className={`grimoire-card ${cooldowns.trap > Date.now() ? "on-cooldown" : ""}`} onClick={() => castSpell("trap")}>
                      <div className="grimoire-card-top">
                        <span className="grimoire-card-name">⚡ Rune Trap</span>
                        <span className="grimoire-card-key">3</span>
                      </div>
                      <div className="grimoire-card-desc">Arcane snare (+50 XP)</div>
                      {cooldowns.trap > Date.now() && <span className="grimoire-cd-badge">{Math.ceil((cooldowns.trap - Date.now()) / 1000)}s</span>}
                    </button>
                    <button type="button" className={`grimoire-card ${cooldowns.ping > Date.now() ? "on-cooldown" : ""}`} onClick={() => castSpell("ping")}>
                      <div className="grimoire-card-top">
                        <span className="grimoire-card-name">🧭 Radar</span>
                        <span className="grimoire-card-key">4</span>
                      </div>
                      <div className="grimoire-card-desc">Track Snitch & Spires</div>
                      {cooldowns.ping > Date.now() && <span className="grimoire-cd-badge">{Math.ceil((cooldowns.ping - Date.now()) / 1000)}s</span>}
                    </button>
                  </div>
                </div>

                <div className="content-heading"><div><span className="section-kicker">CASTLE GROUNDS & SURROUNDINGS</span><h3>Signs of wand magic nearby</h3></div><span className="item-count">{collectibles.length} SPARKLES</span></div>
                <div className="discovery-card">
                  <div className="discovery-art"><div className="art-ring ring-a" /><div className="art-ring ring-b" /><span>✳</span><div className="art-label">FOUND<br />ON GROUNDS</div></div>
                  <div className="discovery-info"><span className="tag-copper">MAGICAL SPARKS</span><h4>Wandering footsteps</h4><p>Little traces left by curious Hogwarts wanderers.</p><div className="reward-line"><Sparkles size={14} /> Gather nearby spark <b>+25 XP</b></div></div>
                </div>
                <div className="find-list">
                  {collectibles.slice(0, 3).map((item) => (
                    <button className="find-row" key={item.id} onClick={() => collect(item)}>
                      <span className={`find-symbol ${item.kind}`}>{item.kind === "relic" ? "✦" : "✳"}</span>
                      <span><b>{item.label}</b><small>{Math.round(distanceMeters(position, item.position))} m from your wand</small></span>
                      <span className="find-points">+{item.points}</span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
                {missions[0] && !activeMission && (
                  <button className="feature-route" onClick={() => startMission(missions[0])}>
                    <span className="route-icon"><Route size={17} /></span>
                    <span><small>FEATURED EXPEDITION · {missions[0].reward} PTS</small><b>{missions[0].title}</b></span>
                    <ArrowUpRight size={16} />
                  </button>
                )}
                {activeMission && (
                  <div className="active-route-banner">
                    <span className="route-icon"><Route size={16} /></span>
                    <div><small>IN PROGRESS</small><b>{missions.find((m) => m.id === activeMission)?.title}</b></div>
                    <button onClick={completeMission}>CHECK IN</button>
                  </div>
                )}
                {quests.filter((q) => q.state === "available").slice(0, 2).map((q) => (
                  <div key={q.id} className="quest-preview" onClick={() => { setSelectedTab("quests"); setQuestTab("available"); }}>
                    <span className="quest-preview-icon"><Flag size={12} /></span>
                    <span><b>{q.title}</b><small>+{q.xpReward} XP · {q.category}</small></span>
                    <ChevronRight size={13} />
                  </div>
                ))}

                {/* Marauder Cartography & Invisibility Cloak Controls */}
                <div style={{ marginTop: 18, paddingTop: 14, borderTop: "2px dashed #b8985c" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ fontSize: 16 }}>⚜</span>
                      <span style={{ font: "700 9px var(--font-wizard-title)", color: "#382513", letterSpacing: "0.05em" }}>
                        Messrs Moony, Wormtail, Padfoot, & Prongs
                      </span>
                    </div>
                    <button
                      type="button"
                      style={{ background: "none", border: 0, color: "#8a572a", font: "700 9px var(--font-wizard-sub)", cursor: "pointer", textDecoration: "underline" }}
                      onClick={() => { playAudioChime("solemn"); setNotice("“I solemnly swear that I am up to no good.” 🪄 Wand salute active!"); }}
                      title="Swear the Marauder's Oath"
                    >
                      Swear Oath 🪄
                    </button>
                  </div>

                  <section className="share-card">
                    <div className="share-card-heading"><span className={visibility === "hidden" ? "share-indicator" : "share-indicator active"} /><b>{visibility === "hidden" ? "Invisibility Cloak: Active (Hidden)" : visibility === "approximate" ? "Disillusionment Charm: Approximate" : "Visible Marauder Footsteps"}</b></div>
                    {visibility === "hidden" ? (
                      <>
                        <label className="share-setting">REVEAL DURATION<select value={shareDuration} onChange={(e) => setShareDuration(Number(e.target.value) as 15 | 60)}><option value={15}>15 minutes</option><option value={60}>1 hour</option></select></label>
                        <div className="share-modes"><button className={sharePrecision === "visible" ? "selected" : ""} onClick={() => setSharePrecision("visible")}>Precise Footsteps</button><button className={sharePrecision === "approximate" ? "selected" : ""} onClick={() => setSharePrecision("approximate")}>Disillusioned (Approx)</button></div>
                        <button className="share-start" onClick={startLocationSharing} disabled={!connected}><Eye size={14} /> Reveal Footprints on Map</button>
                        <small className="share-note">Your footprints appear only when you grant consent. Fold the map anytime with “Mischief managed”.</small>
                      </>
                    ) : (
                      <>
                        <p className="share-expiry">Concealment expires at {shareExpiresAt ? new Date(shareExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "the designated hour"}.</p>
                        <button className="share-stop" onClick={() => stopLocationSharing()}><EyeOff size={14} /> Don Invisibility Cloak (Hide)</button>
                      </>
                    )}
                  </section>
                  <section className="privacy-options">
                    <label><input type="checkbox" checked={proximityEnabled} disabled={visibility === "hidden"} onChange={toggleProximity} /> Marauder Ward Alert within</label>
                    <select value={proximityRadius} disabled={visibility === "hidden"} onChange={(e) => { const radius = Number(e.target.value) as 100 | 250 | 500; setProximityRadius(radius); if (proximityEnabled) socket?.emit("player:proximity", { enabled: true, radiusMeters: radius }); }}><option value={100}>100 m</option><option value={250}>250 m</option><option value={500}>500 m</option></select>
                    <small>Chimes when other witches or wizards wander into your proximity.</small>
                  </section>
                  <section className="destination-tools">
                    <label htmlFor="destination-label">SECRET RENDEZVOUS BEACON</label>
                    <input id="destination-label" maxLength={60} value={destinationLabel} onChange={(e) => setDestinationLabel(e.target.value)} placeholder="e.g. Room of Requirement" />
                    <button className="destination-pick" disabled={visibility === "hidden"} onClick={() => setDestinationMode((active) => !active)}>{destinationMode ? "Click the grounds to cast rendezvous pin" : "Cast Rendezvous Pin on Grounds"}</button>
                    <small>{destinations.length ? `${destinations.length} rendezvous point${destinations.length === 1 ? "" : "s"} visible to active wanderers.` : "Pins are revealed to fellow wanderers currently sharing."}</small>
                  </section>
                  <div className="discovery-toggle-group">
                    <button type="button" onClick={toggleRest} className="status-toggle">
                      <div className="toggle-left">
                        <Activity size={15} />
                        <span>{status === "resting" ? "Resting at Common Room" : status === "on-mission" ? "Patrolling Secret Route" : "Roaming Castle Grounds"}</span>
                      </div>
                      <span className="toggle-badge">{status === "resting" ? "RESUME" : "PAUSE"}</span>
                    </button>
                    <button type="button" className="network-toggle" onClick={() => setDiagnosticsOpen((open) => !open)}>
                      <div className="toggle-left">
                        <Wifi size={15} />
                        <span>Arcane Telemetry Diagnostics</span>
                      </div>
                      <span className="toggle-badge">{diagnosticsOpen ? "OPEN" : "VIEW"}</span>
                    </button>
                  </div>
                  {diagnosticsOpen && (
                    <div className="network-lab">
                      <b>ARCANE CONNECTION TELEMETRY</b>
                      <div className="network-diagnostics">
                        <span>AETHER HEALTH<b>{serverHealth}</b></span>
                        <span>MAGIC RTT<b>{rtt == null ? "Measuring" : `${rtt} ms`}</b></span>
                        <span>SPELLS / SEC<b>{messagesPerSecond}</b></span>
                        <span>PORTKEY RECONNECTS<b>{reconnectCount}</b></span>
                      </div>
                      <small>RTT measures network packet return time. Hogwarts API status checks every 15 seconds.</small>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* QUESTS TAB */}
            {selectedTab === "quests" && (
              <>
                <div className="content-heading"><div><span className="section-kicker">HOGWARTS ADVENTURE LOG</span><h3>Spellbound Quests</h3></div><span className="item-count">{quests.length} TOTAL</span></div>
                <div className="quest-tabs">
                  <button className={questTab === "available" ? "active" : ""} onClick={() => setQuestTab("available")}>Available <span>{quests.filter((q) => q.state === "available").length}</span></button>
                  <button className={questTab === "active" ? "active" : ""} onClick={() => setQuestTab("active")}>Active <span>{quests.filter((q) => q.state === "active").length}</span></button>
                  <button className={questTab === "completed" ? "active" : ""} onClick={() => setQuestTab("completed")}>Done <span>{quests.filter((q) => q.state === "completed").length}</span></button>
                </div>
                {activeMission && (
                  <div className="active-route-banner">
                    <span className="route-icon"><Route size={16} /></span>
                    <div><small>MAP QUEST IN PROGRESS</small><b>{missions.find((m) => m.id === activeMission)?.title}</b></div>
                    <button onClick={completeMission}>CHECK IN</button>
                  </div>
                )}
                <div className="quest-list">
                  {filteredQuests.length === 0 && (
                    <div className="empty-state"><span>📜</span><b>No quests here yet.</b><p>{questTab === "completed" ? "Complete quests around the corridors to record them." : questTab === "active" ? "Accept a quest from the grounds to begin." : "Consult the castle notice boards soon."}</p></div>
                  )}
                  {filteredQuests.map((q) => (
                    <QuestCard
                      key={q.id}
                      quest={q}
                      onAccept={q.state === "available" ? () => acceptQuest(q.id) : undefined}
                      onComplete={q.state === "active" && q.objectives.length > 0 ? () => completeQuestObjective(q.id, q.objectives[0]?.id ?? "", undefined) : undefined}
                    />
                  ))}
                </div>
              </>
            )}

            {/* POTIONS CAULDRON TAB */}
            {selectedTab === "potions" && (
              <div className="potions-cauldron-view">
                <div className="content-heading">
                  <div>
                    <span className="section-kicker">THE DUNGEONS LAB</span>
                    <h3>Potions Master’s Cauldron</h3>
                  </div>
                  <span className="item-count">3 RECIPES</span>
                </div>
                <div className="cauldron-hero-card">
                  <div className="cauldron-bubbling-graphic">
                    <span className="cauldron-pot">🫕</span>
                    <span className="cauldron-bubbles">🫧 🫧 🫧</span>
                  </div>
                  <div className="cauldron-info">
                    <b>Brewing Draughts of Power</b>
                    <p>Combine rare ingredients found in the Forbidden Forest and grounds to brew game-altering draughts!</p>
                    {activePotionEffect && (
                      <div className="active-buff-pill">
                        <span>Active: <b>{activePotionEffect.name}</b></span>
                        <small>{Math.max(0, Math.ceil((activePotionEffect.expiresAt - Date.now()) / 1000))}s remaining</small>
                      </div>
                    )}
                  </div>
                </div>
                <div className="potions-recipes-grid">
                  {POTION_RECIPES.map((potion) => (
                    <div key={potion.id} className="potion-card">
                      <div className="potion-card-top">
                        <span className="potion-icon">{potion.emoji}</span>
                        <div>
                          <h4 className="potion-title">{potion.name}</h4>
                          <small className="potion-ingredients">🧪 {potion.ingredients}</small>
                        </div>
                      </div>
                      <div className="potion-effect-badge">{potion.effect}</div>
                      <div className="potion-duration">Duration: {potion.duration}</div>
                      <button
                        type="button"
                        className="potion-brew-btn"
                        onClick={() => brewPotion(potion.id)}
                      >
                        Brew in Cauldron 🪄
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CHOCOLATE FROG CARDS ALBUM TAB */}
            {selectedTab === "cards" && (
              <div className="frog-cards-view">
                <div className="content-heading">
                  <div>
                    <span className="section-kicker">HOGWARTS COLLECTIBLES</span>
                    <h3>Chocolate Frog Cards</h3>
                  </div>
                  <span className="item-count">{collectedFrogCards.length}/{FROG_CARDS.length} COLLECTED</span>
                </div>
                <div className="frog-album-hero">
                  <span className="frog-hero-icon">🐸</span>
                  <div>
                    <b>Famous Witches & Wizards Album</b>
                    <p>Catch hopping Chocolate Frogs roaming the Hogwarts grounds to unwrap rare holographic cards!</p>
                  </div>
                </div>
                <div className="frog-cards-grid">
                  {FROG_CARDS.map((card) => {
                    const isOwned = collectedFrogCards.includes(card.id);
                    return (
                      <div
                        key={card.id}
                        className={`frog-card-item ${isOwned ? "card-owned" : "card-locked"}`}
                        onClick={() => isOwned && setInspectedCard(card)}
                      >
                        <div className="frog-card-foil-sheen" />
                        <span className="frog-card-avatar">{isOwned ? card.emoji : "❓"}</span>
                        <b className="frog-card-name">{isOwned ? card.name : "Locked Card"}</b>
                        <span className="frog-card-era">{isOwned ? card.era : "Catch Frogs on Map"}</span>
                        {isOwned && <span className="frog-card-inspect-hint">Click to inspect</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ARTIFACTS TAB */}
            {selectedTab === "artifacts" && (
              <>
                <div className="content-heading"><div><span className="section-kicker">THE HOGWARTS RELIQUARY</span><h3>Ancient Relics</h3></div><span className="item-count">{collectedArtifactIds.length}/{artifacts.length}</span></div>
                <div className="artifacts-grid">
                  {artifacts.map((artifact) => (
                    <ArtifactCard key={artifact.id} artifact={artifact} collected={collectedArtifactIds.includes(artifact.id)} />
                  ))}
                  {artifacts.length === 0 && <div className="empty-state"><span>✨</span><b>Your reliquary awaits.</b><p>Explore the secret passageways and complete quests to discover authentic magical relics.</p></div>}
                </div>
              </>
            )}

            {/* ACHIEVEMENTS TAB */}
            {selectedTab === "achievements" && (
              <>
                <div className="content-heading"><div><span className="section-kicker">ORDER OF MERLIN HONORS</span><h3>Accolades of Mischief</h3></div><span className="item-count">{achievements.filter((a) => a.unlocked).length}/{achievements.length}</span></div>
                <div className="achievement-list">
                  {achievements.map((ach) => <AchievementCard key={ach.id} ach={ach} />)}
                  {achievements.length === 0 && <div className="empty-state"><span>🏆</span><b>Begin exploring to earn honors.</b><p>Cast spells, capture house spires, intercept the Golden Snitch, and cooperate with fellow students.</p></div>}
                </div>
              </>
            )}

            {/* PLAYERS TAB */}
            {selectedTab === "players" && (
              <>
                <div className="content-heading"><div><span className="section-kicker">FELLOW MARAUDERS</span><h3>Witches & Wizards Nearby</h3></div><span className="item-count">{nearby.length} NEARBY</span></div>
                <div className="nearby-list">
                  {nearby.length ? nearby.map((p) => (
                    <div className="nearby-row" key={p.id}>
                      <span className="nearby-avatar">{p.avatar}</span>
                      <div className="nearby-info"><b>{p.username}</b><small>{p.faction ? `House ${p.faction.toUpperCase()}` : "Hogwarts Student"} · {p.status === "on-mission" ? "Patrolling secret passage" : p.status === "resting" ? "Resting in common room" : "Roaming castle grounds"}</small></div>
                      <div className="nearby-action-col">
                        <span className="nearby-distance">{Math.round(distanceMeters(position, p.position))} m</span>
                        <button
                          type="button"
                          className="nearby-duel-btn"
                          onClick={() => startPlayerDuel(p)}
                          title={`Challenge ${p.username} to a wand duel`}
                        >
                          ⚔️ Duel
                        </button>
                      </div>
                    </div>
                  )) : (
                    <div className="empty-nearby"><span>☼</span><b>The corridors are quiet.</b><p>Fellow wanderers appear when they step onto the grounds.</p></div>
                  )}
                </div>
              </>
            )}

            {/* FRIENDS TAB */}
            {selectedTab === "friends" && (
              <div className="friends-view">
                <div className="content-heading"><div><span className="section-kicker">OWL POST CIRCLE</span><h3>Trusted Allies & Kin</h3></div><span className="item-count">{friends.length} ALLIES</span></div>
                <form className="friend-search" onSubmit={searchPeople}>
                  <input value={friendSearch} onChange={(e) => setFriendSearch(e.target.value)} maxLength={20} minLength={1} placeholder="Search by wizarding name" aria-label="Search users by username" />
                  <button type="submit" disabled={friendBusy} aria-label="Search"><Search size={15} /></button>
                </form>
                {friendMatches.length > 0 && (
                  <section className="social-list">
                    <span className="social-kicker">SEARCH RESULTS</span>
                    {friendMatches.map((person) => { const alreadyFriend = friends.some((friend) => friend.id === person.id); const pending = outgoingRequests.some((request) => request.recipient?.id === person.id); return (<div className="social-row" key={person.id}><span className="social-avatar">{person.avatar}</span><b>{person.username}</b><button disabled={alreadyFriend || pending} onClick={() => void sendFriendRequest(person)}>{alreadyFriend ? "Friends" : pending ? "Pending" : <><UserPlus size={13} /> Add</>}</button></div>); })}
                  </section>
                )}
                {incomingRequests.length > 0 && (
                  <section className="social-list">
                    <span className="social-kicker">INCOMING OWL MESSAGES · {incomingRequests.length}</span>
                    {incomingRequests.map((request) => (<div className="social-row" key={request.id}><span className="social-avatar">{request.sender.avatar}</span><b>{request.sender.username}</b><button className="accept-request" onClick={() => void respondToFriendRequest(request.id, "accept")} aria-label={`Accept ${request.sender.username}`}><Check size={13} /></button><button className="reject-request" onClick={() => void respondToFriendRequest(request.id, "reject")} aria-label={`Decline ${request.sender.username}`}><X size={13} /></button></div>))}
                  </section>
                )}
                <section className="social-list">
                  <span className="social-kicker">YOUR TRUSTED ALLIES · {friends.length}</span>
                  {friends.length ? friends.map((friend) => (<div className="social-row" key={friend.id}><span className="social-avatar">{friend.avatar}</span><b>{friend.username}</b><button className="remove-friend" onClick={() => void removeFriend(friend)} aria-label={`Remove ${friend.username}`}><UserMinus size={13} /></button></div>)) : (<div className="social-empty">Send an Owl by searching a wizard alias. You can explore private chambers together.</div>)}
                </section>
                {outgoingRequests.length > 0 && (
                  <section className="social-list">
                    <span className="social-kicker">OWLS EN ROUTE · {outgoingRequests.length}</span>
                    {outgoingRequests.map((request) => (<div className="social-row" key={request.id}><span className="social-avatar">{request.recipient?.avatar ?? "✉"}</span><b>{request.recipient?.username ?? "Wizard"}</b><small>Pending</small><button className="remove-friend" onClick={() => { void apiFetch(`${API}/friends/requests/${request.id}`, { method: "DELETE", headers: authHeaders }).then(refreshSocial); }} aria-label="Cancel request"><X size={13} /></button></div>))}
                  </section>
                )}
              </div>
            )}

            {/* LEADERBOARD / THE GREAT HALL HOUSE CUP TAB */}
            {selectedTab === "leaderboard" && (
              <>
                <div className="content-heading"><div><span className="section-kicker">THE GREAT HALL</span><h3>The Hogwarts House Cup</h3></div>{userRank && <span className="item-count">YOUR STANDING #{userRank}</span>}</div>

                {/* The 4 Hogwarts House Hourglasses */}
                <div className="house-cup-card">
                  <div className="house-cup-header">
                    <h4 className="house-cup-title">HOUSE POINT HOURGLASSES</h4>
                    <span className="house-cup-subtitle">Live jewel tallies reflecting House member achievements</span>
                  </div>
                  <div className="house-hourglass-grid">
                    {(["gryffindor", "slytherin", "ravenclaw", "hufflepuff"] as const).map((hKey) => {
                      const hInfo = HOUSE_DATA[hKey];
                      const pts = houseScores[hKey] ?? 350;
                      const pct = Math.max(15, Math.min(100, Math.round((pts / maxHouseScore) * 100)));
                      return (
                        <div key={hKey} className={`house-hourglass-item hourglass-${hKey}`}>
                          <span className="hourglass-house-icon">{hInfo.emoji}</span>
                          <div className="hourglass-cylinder">
                            <div className="hourglass-sand-fill" style={{ height: `${pct}%` }} />
                          </div>
                          <span className="hourglass-house-pts">{pts}</span>
                          <span className="hourglass-house-name">{hInfo.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="content-heading"><div><span className="section-kicker">ORDER OF MERLIN</span><h3>Student Standings</h3></div></div>
                <div className="leaderboard-list">
                  {leaderboard.map((entry) => (
                    <div key={entry.userId} className={`leaderboard-row ${entry.userId === me.id ? "leaderboard-me" : ""}`}>
                      <div className="leaderboard-rank">
                        {entry.rank === 1 ? <Crown size={16} className="rank-gold" /> : entry.rank === 2 ? <Star size={14} className="rank-silver" /> : entry.rank === 3 ? <Star size={13} className="rank-bronze" /> : <span className="rank-num">#{entry.rank}</span>}
                      </div>
                      <span className="leaderboard-avatar">{entry.avatar}</span>
                      <div className="leaderboard-info"><b>{entry.username}</b><small>Year {entry.level} · {entry.levelTitle}</small></div>
                      <div className="leaderboard-xp"><b>{entry.xpTotal}</b><small>XP</small></div>
                    </div>
                  ))}
                  {leaderboard.length === 0 && <div className="empty-state"><span>🏆</span><b>Complete quests to earn points for your House.</b><p>Scores update in real time with validated discoveries and achievements.</p></div>}
                </div>
              </>
            )}

            {/* HOGWARTS DUELING CLUB ARENA TAB */}
            {selectedTab === "duel" && (
              <div className="duel-arena-view">
                <div className="content-heading">
                  <div>
                    <span className="section-kicker">THE GREAT HALL PLATFORM</span>
                    <h3>Hogwarts Dueling Club</h3>
                  </div>
                  <div className="duel-header-stats">
                    <span className="duel-wins-badge">🏆 {duelWinsCount} Won</span>
                    <span className="item-count">{duelActive ? "DUEL IN PROGRESS" : `${online.length} ACTIVE`}</span>
                  </div>
                </div>

                {duelActive && duelOpponent ? (
                  /* ── ACTIVE DUEL ARENA ── */
                  <div className="duel-battle-container">
                    {/* Top status bar with turn info and forfeit */}
                    <div className="duel-turn-bar">
                      <span className="duel-turn-indicator">Round {duelTurnCount} · Wands Raised</span>
                      <button type="button" className="duel-concede-btn" onClick={resetDuel} title="Concede and step down from platform">
                        Step Down 🏃‍♂️
                      </button>
                    </div>

                    {/* Dueling Platform Stage */}
                    <div className="duel-stage-platform">
                      <div className="platform-runner-gold" />

                      {/* Left Wizard: Player */}
                      <div className={`duel-combatant-card combatant-player ${duelSpellAnimation?.caster === "player" ? "casting-surge" : ""}`}>
                        <div className="combatant-avatar-wrap">
                          <span className="combatant-avatar">{me?.avatar ?? "🦁"}</span>
                          <span className={`combatant-house-ring ring-${faction}`} />
                        </div>
                        <div className="combatant-details">
                          <span className="combatant-name">{me?.username ?? "You"}</span>
                          <span className="combatant-title">House {HOUSE_DATA[faction]?.name ?? "Gryffindor"}</span>
                        </div>
                        {/* HP Ward Bar */}
                        <div className="ward-gauge-wrap">
                          <div className="ward-gauge-meta">
                            <span className="ward-gauge-label">WARD</span>
                            <span className="ward-gauge-val">{duelPlayerHp}/100</span>
                          </div>
                          <div className="ward-track">
                            <div
                              className="ward-fill"
                              style={{
                                width: `${Math.max(0, Math.min(100, duelPlayerHp))}%`,
                                backgroundColor: duelPlayerHp > 50 ? "#22c55e" : duelPlayerHp > 25 ? "#eab308" : "#ef4444",
                              }}
                            />
                            {duelPlayerShield > 0 && (
                              <div className="ward-shield-overlay" style={{ width: `${Math.min(100, duelPlayerShield * 2.8)}%` }} />
                            )}
                          </div>
                        </div>

                        {/* Status Badges */}
                        <div className="combatant-status-row">
                          {duelPlayerShield > 0 && <span className="status-badge-shield">🛡️ Protego (+{duelPlayerShield})</span>}
                          {duelPlayerStunned && <span className="status-badge-stun">🗿 Bound</span>}
                          {duelPlayerBurn > 0 && <span className="status-badge-burn">🔥 Incendio ({duelPlayerBurn})</span>}
                        </div>

                        {/* Speech Bubble */}
                        {duelSpeechBubble?.speaker === "player" && (
                          <div className="combat-speech-bubble bubble-left">
                            {duelSpeechBubble.text}
                          </div>
                        )}
                      </div>

                      {/* Center Clash & Spell Rays Arena */}
                      <div className="duel-center-nexus">
                        {isClashing ? (
                          /* Priori Incantatem Golden Interlock */
                          <div className="priori-incantatem-hud">
                            <div className="priori-bead-thread">
                              <div className="priori-golden-beam" />
                              <div
                                className="priori-golden-bead"
                                style={{ left: `${clashTug}%` }}
                              />
                            </div>
                            <div className="priori-tap-banner">
                              <span className="priori-kicker">⚡ PRIORI INCANTATEM!</span>
                              <span className="priori-timer">Timer: {Math.max(0, clashTimer).toFixed(1)}s</span>
                            </div>
                            <button
                              type="button"
                              className="priori-surge-btn"
                              onClick={surgeWand}
                              title="Rapidly click or press SPACEBAR to surge power"
                            >
                              ⚡ SURGE WAND! (TAP / SPACE)
                            </button>
                          </div>
                        ) : duelSpellAnimation ? (
                          /* Animated flying spell ray */
                          <div className={`spell-beam-ray ray-${duelSpellAnimation.caster}`}>
                            <div
                              className="spell-beam-glow"
                              style={{ backgroundColor: duelSpellAnimation.color, boxShadow: `0 0 20px ${duelSpellAnimation.color}` }}
                            />
                            <span className="spell-incantation-callout" style={{ color: duelSpellAnimation.color }}>
                              {duelSpellAnimation.spell}
                            </span>
                          </div>
                        ) : (
                          <div className="duel-wands-crossed">
                            <span className="crossed-wands-rune">⚔️</span>
                            <span className="nexus-prompt">Cast a Spell</span>
                          </div>
                        )}
                      </div>

                      {/* Right Wizard: Opponent */}
                      <div className={`duel-combatant-card combatant-opponent ${duelSpellAnimation?.caster === "opponent" ? "casting-surge" : ""}`}>
                        <div className="combatant-avatar-wrap">
                          <span className="combatant-avatar">{duelOpponent.avatar}</span>
                          <span className={`combatant-house-ring ring-${duelOpponent.house}`} />
                        </div>
                        <div className="combatant-details">
                          <span className="combatant-name">{duelOpponent.name}</span>
                          <span className="combatant-title">
                            {duelOpponent.isBot ? duelOpponent.botConfig?.title ?? "Hogwarts Duelist" : `House ${duelOpponent.house.toUpperCase()}`}
                          </span>
                        </div>
                        {/* HP Ward Bar */}
                        <div className="ward-gauge-wrap">
                          <div className="ward-gauge-meta">
                            <span className="ward-gauge-label">WARD</span>
                            <span className="ward-gauge-val">{duelOpponentHp}/100</span>
                          </div>
                          <div className="ward-track">
                            <div
                              className="ward-fill"
                              style={{
                                width: `${Math.max(0, Math.min(100, duelOpponentHp))}%`,
                                backgroundColor: duelOpponentHp > 50 ? "#22c55e" : duelOpponentHp > 25 ? "#eab308" : "#ef4444",
                              }}
                            />
                            {duelOpponentShield > 0 && (
                              <div className="ward-shield-overlay" style={{ width: `${Math.min(100, duelOpponentShield * 2.8)}%` }} />
                            )}
                          </div>
                        </div>

                        {/* Status Badges */}
                        <div className="combatant-status-row">
                          {duelOpponentShield > 0 && <span className="status-badge-shield">🛡️ Protego (+{duelOpponentShield})</span>}
                          {duelOpponentStunned && <span className="status-badge-stun">🗿 Bound</span>}
                          {duelOpponentBurn > 0 && <span className="status-badge-burn">🔥 Incendio ({duelOpponentBurn})</span>}
                        </div>

                        {/* Speech Bubble */}
                        {duelSpeechBubble?.speaker === "opponent" && (
                          <div className="combat-speech-bubble bubble-right">
                            {duelSpeechBubble.text}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Spell Deck Action Console */}
                    <div className="duel-deck-section">
                      <div className="duel-deck-header">
                        <span className="duel-deck-kicker">WAND DECK · CHOOSE INCANTATION</span>
                        <span className="duel-deck-hotkey-hint">Keys 1-6</span>
                      </div>
                      <div className="duel-spell-deck">
                        {DUEL_SPELLS.map((sp, idx) => {
                          const cd = duelSpellCooldowns[sp.id] ?? 0;
                          return (
                            <button
                              key={sp.id}
                              type="button"
                              className={`duel-spell-card card-${sp.effectType} ${cd > 0 ? "on-cooldown" : ""}`}
                              onClick={() => castDuelSpell(sp)}
                              disabled={cd > 0 || isClashing || duelOutcome !== null}
                              title={`${sp.name}: ${sp.description}`}
                            >
                              <div className="spell-card-top">
                                <span className="spell-card-key">{idx + 1}</span>
                                <span className="spell-card-icon">{sp.icon}</span>
                                {cd > 0 ? (
                                  <span className="spell-card-cd">{cd}r</span>
                                ) : (
                                  <span className="spell-card-type">{sp.effectType.toUpperCase()}</span>
                                )}
                              </div>
                              <div className="spell-card-name">{sp.name}</div>
                              <div className="spell-card-latin">{sp.latin}</div>
                              <div className="spell-card-desc">{sp.description}</div>
                              <div className="spell-card-stat">
                                {sp.damageRange[1] > 0
                                  ? `⚡ ${sp.damageRange[0]}-${sp.damageRange[1]} DMG`
                                  : sp.effectType === "shield"
                                  ? `🛡️ +35 WARD`
                                  : `✨ +25 HEAL`}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Live Parchment Duel Chronicle Log */}
                    <div className="duel-chronicle-box">
                      <div className="chronicle-header">
                        <span>📜 DUELING CHRONICLE</span>
                        <small>Official Great Hall Records</small>
                      </div>
                      <div className="chronicle-scroll">
                        {duelLog.map((entry) => (
                          <div key={entry.id} className={`chronicle-entry entry-${entry.type}`}>
                            <span className="entry-time">[{entry.time}]</span>
                            <span className="entry-text">{entry.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Outcome Modal / Banner */}
                    {duelOutcome && (
                      <div className="duel-outcome-modal">
                        <div className={`duel-outcome-card outcome-${duelOutcome}`}>
                          <span className="outcome-icon">{duelOutcome === "victory" ? "🏆✨" : "🪄💫"}</span>
                          <h2 className="outcome-title">
                            {duelOutcome === "victory" ? "TRIUMPH AT THE DUELING CLUB!" : "DISARMED & FELLED!"}
                          </h2>
                          <p className="outcome-sub">
                            {duelOutcome === "victory"
                              ? `You have bested ${duelOpponent.name} on the Great Hall stage! House pride reaffirmed!`
                              : `Your wand was knocked from your hand by ${duelOpponent.name}. Practice your deflections!`}
                          </p>
                          {duelOutcome === "victory" && (
                            <div className="outcome-rewards-pills">
                              <span className="reward-pill">+120 XP</span>
                              <span className="reward-pill">+50 House Cup Points</span>
                              <span className="reward-pill">Order of Merlin Honor</span>
                            </div>
                          )}
                          <div className="outcome-actions">
                            {duelOpponent.isBot && (
                              <button
                                type="button"
                                className="outcome-btn outcome-rematch-btn"
                                onClick={() => startBotDuel(duelOpponent.botConfig!)}
                              >
                                Rematch Duel ⚔️
                              </button>
                            )}
                            <button
                              type="button"
                              className="outcome-btn outcome-close-btn"
                              onClick={resetDuel}
                            >
                              Bow & Return to Roster 📜
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* ── DUELING CLUB LOBBY & ROSTER ── */
                  <div className="duel-lobby-view">
                    {/* Hogwarts Dueling Club Welcome Banner */}
                    <div className="dueling-welcome-card">
                      <div className="dueling-welcome-top">
                        <span className="dueling-club-emblem">⚔️</span>
                        <div>
                          <h4 className="dueling-club-title">HOGWARTS DUELING PLATFORM</h4>
                          <span className="dueling-club-sub">Est. 1992 · Supervised by the D.A. & Faculty</span>
                        </div>
                      </div>
                      <p className="dueling-club-quote">
                        “Wands at the ready! Remember your counter-curses, shield charms, and when spell beams meet, prepare for Priori Incantatem!”
                      </p>
                    </div>

                    {/* Section 1: Real Active Wanderers (Online Players) */}
                    <div className="duel-section-group">
                      <div className="duel-group-header">
                        <span className="group-kicker">WAND-BEARERS IN THE CORRIDORS</span>
                        <h4>Challenge Active Wizards</h4>
                      </div>
                      {online.length > 0 ? (
                        <div className="active-duel-players-grid">
                          {online.map((p) => (
                            <div key={p.id} className="player-duel-card">
                              <div className="player-duel-avatar-wrap">
                                <span className="player-duel-avatar">{p.avatar}</span>
                                <span className={`player-house-badge badge-${p.faction ?? "gryffindor"}`} />
                              </div>
                              <div className="player-duel-info">
                                <b className="player-duel-name">{p.username}</b>
                                <small className="player-duel-house">
                                  {p.faction ? `House ${p.faction.toUpperCase()}` : "Hogwarts Student"} · {Math.round(distanceMeters(position, p.position))}m
                                </small>
                              </div>
                              <button
                                type="button"
                                className="issue-challenge-btn"
                                onClick={() => startPlayerDuel(p)}
                                title={`Challenge ${p.username} to a live wand duel`}
                              >
                                ⚔️ Issue Challenge
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="no-players-duel-notice">
                          <span>🕯️</span>
                          <b>No other wanderers currently in the corridors.</b>
                          <p>
                            Duel the master Hogwarts Champions below! They are programmed with authentic personalities, signature spells, and combat intelligence.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Section 2: Hogwarts Champions Roster (Bot Duelists) */}
                    <div className="duel-section-group">
                      <div className="duel-group-header">
                        <span className="group-kicker">HOGWARTS DUELING ROSTER</span>
                        <h4>Duel Famous Witches & Wizards</h4>
                      </div>
                      <div className="bot-duelists-grid">
                        {HOGWARTS_BOT_DUELISTS.map((bot) => {
                          const botShortName = bot.id === "bot-voldemort" ? "Voldemort" : bot.id === "bot-dumbledore" ? "Dumbledore" : bot.name.split(" ")[0];
                          return (
                            <div key={bot.id} className={`bot-duelist-card house-${bot.house} bot-card-${bot.id}`}>
                              <div className="bot-card-top">
                                <div className="bot-avatar-crest">
                                  <span className="bot-avatar">{bot.avatar}</span>
                                  <span className="bot-house-tag">{bot.house.toUpperCase()}</span>
                                </div>
                                <span className={`bot-diff-badge diff-${bot.difficulty.toLowerCase()}`}>
                                  {bot.difficulty}
                                </span>
                              </div>
                              <div className="bot-card-body">
                                <h4 className="bot-name">{bot.name}</h4>
                                <span className="bot-title">{bot.title}</span>
                                <div className="bot-wand-line">🪄 {bot.wand}</div>
                                <p className="bot-quote">{bot.quote}</p>
                                <div className="bot-spells-tags">
                                  {bot.spells.map((s) => (
                                    <span key={s} className="bot-spell-pill">{s}</span>
                                  ))}
                                </div>
                              </div>
                              <button
                                type="button"
                                className="duel-bot-start-btn"
                                onClick={() => startBotDuel(bot)}
                              >
                                <span>⚔️ Duel {botShortName}</span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Section 3: Flitwick & Lockhart Dueling Etiquette Codex */}
                    <div className="dueling-codex-card">
                      <h4 className="codex-title">📜 DUELING CLUB REGULATIONS</h4>
                      <ul className="codex-rules-list">
                        <li><b>Rule I: Formal Bow</b> — Face your opponent, bow respectfully, and turn on the count of three.</li>
                        <li><b>Rule II: Shield & Counter</b> — Cast <em>Protego</em> to deflect high-damage curses and absorb heavy impacts.</li>
                        <li><b>Rule III: Priori Incantatem</b> — When twin offensive beams meet, enter the wand surge tug-of-war to overpower your opponent!</li>
                        <li><b>Rule IV: Body-Bind</b> — Use <em>Petrificus Totalus</em> to lock the opponent rigid and buy precious seconds.</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Compact Sticky Footer */}
          <footer className="panel-footer-compact">
            <button
              type="button"
              className="mischief-managed-btn"
              style={{ width: "100%", height: 36, justifyContent: "center" }}
              onClick={manageMischief}
              title="Wipe map clean and fold into blank parchment"
            >
              <Sparkles size={13} />
              <span>“Mischief managed.” ✨</span>
            </button>
            <div className="footer-status-bar">
              <span>THE MARAUDER’S MAP</span>
              <span>{visibility === "hidden" ? "👤 Invisibility Cloak" : "👣 Footprints Live"}</span>
            </div>
          </footer>
        </aside>

      </div>

      {/* Toast notification */}
      {notice && <div className="toast"><span>✳</span>{notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}

      {/* Mobile Backdrop Overlay */}
      {panelOpen && (
        <div
          className="mobile-backdrop"
          onClick={() => {
            setPanelOpen(false);
            setMapRefresh((n) => n + 1);
          }}
          aria-hidden="true"
        />
      )}

      {/* Enhanced Mobile Bottom Dock */}
      <nav className="mobile-dock" aria-label="Magical Quick Navigation">
        <button
          type="button"
          className={`dock-btn ${!panelOpen ? "dock-active" : ""}`}
          onClick={() => {
            setPanelOpen(false);
            setMapRefresh((n) => n + 1);
          }}
        >
          <span className="dock-icon">🗺️</span>
          <span className="dock-label">Map</span>
        </button>

        <button
          type="button"
          className={`dock-btn ${panelOpen && selectedTab === "quests" ? "dock-active" : ""}`}
          onClick={() => {
            setSelectedTab("quests");
            setPanelOpen(true);
            void loadQuests();
          }}
        >
          <span className="dock-icon"><Flag size={15} /></span>
          <span className="dock-label">Quests</span>
          {quests.filter((q) => q.state === "active").length > 0 && (
            <span className="dock-badge">{quests.filter((q) => q.state === "active").length}</span>
          )}
        </button>

        <button
          type="button"
          className={`dock-btn ${panelOpen && selectedTab === "potions" ? "dock-active" : ""}`}
          onClick={() => {
            setSelectedTab("potions");
            setPanelOpen(true);
          }}
        >
          <span className="dock-icon">🧪</span>
          <span className="dock-label">Potions</span>
        </button>

        <button
          type="button"
          className={`dock-btn ${panelOpen && selectedTab === "duel" ? "dock-active" : ""}`}
          onClick={() => {
            setSelectedTab("duel");
            setPanelOpen(true);
          }}
        >
          <span className="dock-icon">⚔️</span>
          <span className="dock-label">Duel</span>
          {duelActive && <span className="dock-badge">VS</span>}
        </button>

        <button
          type="button"
          className={`dock-btn ${panelOpen && selectedTab === "leaderboard" ? "dock-active" : ""}`}
          onClick={() => {
            setSelectedTab("leaderboard");
            setPanelOpen(true);
            void loadLeaderboard();
          }}
        >
          <span className="dock-icon"><Trophy size={15} /></span>
          <span className="dock-label">House Cup</span>
        </button>

        <button
          type="button"
          className={`dock-btn ${panelOpen && selectedTab !== "quests" && selectedTab !== "potions" && selectedTab !== "duel" && selectedTab !== "leaderboard" ? "dock-active" : ""}`}
          onClick={() => {
            setPanelOpen(!panelOpen);
            setMapRefresh((n) => n + 1);
          }}
        >
          <span className="dock-icon"><Book size={15} /></span>
          <span className="dock-label">{panelOpen ? "Close" : "Codex"}</span>
          {(incomingRequests.length > 0 || collectedFrogCards.length > 0) && (
            <span className="dock-badge">{(incomingRequests.length || 0) + (collectedFrogCards.length ? 1 : 0)}</span>
          )}
        </button>

        <div className="dock-status" title={`Latency: ${rtt ?? "—"} ms`}>
          <span className={connected ? "dock-status-dot online" : "dock-status-dot offline"} />
          <span>{rtt == null ? "—" : `${rtt}ms`}</span>
        </div>
      </nav>

      {/* Incoming Duel Challenge Scroll Modal */}
      {incomingChallenge && (
        <div className="snitch-catch-modal">
          <div className="snitch-celebration-card duel-challenge-modal-card">
            <span className="snitch-big-icon">⚔️📜</span>
            <h2 className="snitch-celebration-title">CHALLENGE TO A DUEL!</h2>
            <p className="snitch-celebration-subtitle">
              <b>{incomingChallenge.fromName}</b> has challenged you to an authentic wand duel on the Great Hall stage!
            </p>
            <div className="duel-invitation-badge-row">
              <span className="invitation-avatar">{incomingChallenge.fromAvatar ?? "🧙"}</span>
              <div className="invitation-details">
                <b>{incomingChallenge.fromName}</b>
                <small>House {incomingChallenge.fromFaction?.toUpperCase() ?? "GRYFFINDOR"}</small>
              </div>
            </div>
            <div className="challenge-modal-actions">
              <button
                type="button"
                className="challenge-accept-btn"
                onClick={acceptChallenge}
              >
                Accept Challenge 🪄
              </button>
              <button
                type="button"
                className="challenge-decline-btn"
                onClick={declineChallenge}
              >
                Decline 🏃‍♂️
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
