import type { LucideIcon } from "lucide-react";
import {
  Bird,
  BookOpen,
  Bot,
  Brain,
  Bug,
  Camera,
  Cat,
  Cloud,
  Code,
  Coffee,
  Compass,
  Cpu,
  Database,
  Feather,
  Fingerprint,
  Flame,
  Flower2,
  Ghost,
  Globe,
  Hammer,
  Heart,
  Hexagon,
  Home,
  Key,
  Landmark,
  Leaf,
  Lightbulb,
  Lock,
  Mail,
  Map,
  MessageSquare,
  Mic,
  Moon,
  Music,
  Orbit,
  Palette,
  PawPrint,
  PenLine,
  Puzzle,
  Radar,
  Rocket,
  Search,
  Shield,
  Ship,
  Sparkles,
  Sprout,
  Star,
  Sun,
  Terminal,
  Trees,
  WandSparkles,
  Wrench,
  Zap,
} from "lucide-react";

/**
 * Curated lucide-react icons for agent identity. Keys are the lucide
 * export names the API stores on `Agent.icon` (default "Bot").
 */
export const AGENT_ICONS = {
  Bird,
  BookOpen,
  Bot,
  Brain,
  Bug,
  Camera,
  Cat,
  Cloud,
  Code,
  Coffee,
  Compass,
  Cpu,
  Database,
  Feather,
  Fingerprint,
  Flame,
  Flower2,
  Ghost,
  Globe,
  Hammer,
  Heart,
  Hexagon,
  Home,
  Key,
  Landmark,
  Leaf,
  Lightbulb,
  Lock,
  Mail,
  Map,
  MessageSquare,
  Mic,
  Moon,
  Music,
  Orbit,
  Palette,
  PawPrint,
  PenLine,
  Puzzle,
  Radar,
  Rocket,
  Search,
  Shield,
  Ship,
  Sparkles,
  Sprout,
  Star,
  Sun,
  Terminal,
  Trees,
  WandSparkles,
  Wrench,
  Zap,
} as const satisfies Record<string, LucideIcon>;

export type AgentIconName = keyof typeof AGENT_ICONS;

export const AGENT_ICON_NAMES = Object.keys(AGENT_ICONS) as AgentIconName[];

export const DEFAULT_AGENT_ICON: AgentIconName = "Bot";

export function isAgentIconName(value: unknown): value is AgentIconName {
  return typeof value === "string" && value in AGENT_ICONS;
}

export function resolveAgentIconName(value: unknown): AgentIconName {
  return isAgentIconName(value) ? value : DEFAULT_AGENT_ICON;
}

export function getAgentIcon(value: unknown): LucideIcon {
  return AGENT_ICONS[resolveAgentIconName(value)];
}
