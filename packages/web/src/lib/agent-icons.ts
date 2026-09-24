import {
  Bot,
  Brain,
  Bug,
  Compass,
  Code,
  Cpu,
  Feather,
  Flame,
  Flower2,
  Globe,
  Hammer,
  Heart,
  Leaf,
  Lightbulb,
  Map,
  MessageSquare,
  Moon,
  Mountain,
  Music,
  Orbit,
  Palette,
  PawPrint,
  Rocket,
  Search,
  Shield,
  Sparkles,
  Sprout,
  Star,
  Sun,
  Telescope,
  Terminal,
  Trees,
  WandSparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export const AGENT_ICONS: Record<string, LucideIcon> = {
  Bot,
  Brain,
  Bug,
  Compass,
  Code,
  Cpu,
  Feather,
  Flame,
  Flower2,
  Globe,
  Hammer,
  Heart,
  Leaf,
  Lightbulb,
  Map,
  MessageSquare,
  Moon,
  Mountain,
  Music,
  Orbit,
  Palette,
  PawPrint,
  Rocket,
  Search,
  Shield,
  Sparkles,
  Sprout,
  Star,
  Sun,
  Telescope,
  Terminal,
  Trees,
  WandSparkles,
  Wrench,
};

export const AGENT_ICON_NAMES = Object.keys(AGENT_ICONS).sort();

export function agentIconOf(name: unknown): LucideIcon {
  if (typeof name === "string" && AGENT_ICONS[name]) return AGENT_ICONS[name]!;
  return Bot;
}

export function agentIconNameOf(name: unknown): string {
  if (typeof name === "string" && AGENT_ICONS[name]) return name;
  return "Bot";
}
