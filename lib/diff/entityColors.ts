import type { EntityType, FileType } from "./diffTypes";
import {
  FileText,
  Database,
  ImageIcon,
  Mail,
  Phone,
  ShieldAlert,
  CreditCard,
  User,
  MapPin,
  Wallet,
  Globe,
  Fingerprint,
  Calendar,
  type LucideIcon,
} from "lucide-react";

// ─── Entity color tokens ─────────────────────────────────────────────────────
// Returns Tailwind classes for chip badges (header / filter bar)

export interface EntityColorSet {
  chipBg: string;
  chipText: string;
  chipBorder: string;
  // original panel word highlight
  wordBgOrig: string;
  wordTextOrig: string;
  // sanitized panel word highlight
  wordBgSan: string;
  wordTextSan: string;
  // line number tint when PII present
  lineNumTint: string;
}

const colorMap: Record<EntityType, EntityColorSet> = {
  EMAIL: {
    chipBg: "bg-blue-50",
    chipText: "text-blue-700",
    chipBorder: "border-blue-200",
    wordBgOrig: "bg-blue-200",
    wordTextOrig: "text-blue-900",
    wordBgSan: "bg-blue-300",
    wordTextSan: "text-blue-900",
    lineNumTint: "text-blue-400",
  },
  PHONE: {
    chipBg: "bg-violet-50",
    chipText: "text-violet-700",
    chipBorder: "border-violet-200",
    wordBgOrig: "bg-violet-200",
    wordTextOrig: "text-violet-900",
    wordBgSan: "bg-violet-300",
    wordTextSan: "text-violet-900",
    lineNumTint: "text-violet-400",
  },
  AADHAAR: {
    chipBg: "bg-red-50",
    chipText: "text-red-700",
    chipBorder: "border-red-200",
    wordBgOrig: "bg-red-200",
    wordTextOrig: "text-red-900",
    wordBgSan: "bg-red-300",
    wordTextSan: "text-red-900",
    lineNumTint: "text-red-400",
  },
  PAN: {
    chipBg: "bg-orange-50",
    chipText: "text-orange-700",
    chipBorder: "border-orange-200",
    wordBgOrig: "bg-orange-200",
    wordTextOrig: "text-orange-900",
    wordBgSan: "bg-orange-300",
    wordTextSan: "text-orange-900",
    lineNumTint: "text-orange-400",
  },
  NAME: {
    chipBg: "bg-pink-50",
    chipText: "text-pink-700",
    chipBorder: "border-pink-200",
    wordBgOrig: "bg-pink-200",
    wordTextOrig: "text-pink-900",
    wordBgSan: "bg-pink-300",
    wordTextSan: "text-pink-900",
    lineNumTint: "text-pink-400",
  },
  ADDRESS: {
    chipBg: "bg-yellow-50",
    chipText: "text-yellow-700",
    chipBorder: "border-yellow-200",
    wordBgOrig: "bg-yellow-200",
    wordTextOrig: "text-yellow-900",
    wordBgSan: "bg-yellow-300",
    wordTextSan: "text-yellow-900",
    lineNumTint: "text-yellow-400",
  },
  CARD_NUMBER: {
    chipBg: "bg-red-50",
    chipText: "text-red-700",
    chipBorder: "border-red-200",
    wordBgOrig: "bg-red-200",
    wordTextOrig: "text-red-900",
    wordBgSan: "bg-red-300",
    wordTextSan: "text-red-900",
    lineNumTint: "text-red-400",
  },
  UPI: {
    chipBg: "bg-green-50",
    chipText: "text-green-700",
    chipBorder: "border-green-200",
    wordBgOrig: "bg-green-200",
    wordTextOrig: "text-green-900",
    wordBgSan: "bg-green-300",
    wordTextSan: "text-green-900",
    lineNumTint: "text-green-400",
  },
  CVV: {
    chipBg: "bg-red-50",
    chipText: "text-red-700",
    chipBorder: "border-red-200",
    wordBgOrig: "bg-red-300",
    wordTextOrig: "text-red-900",
    wordBgSan: "bg-red-400",
    wordTextSan: "text-red-900",
    lineNumTint: "text-red-400",
  },
  PASSPORT: {
    chipBg: "bg-indigo-50",
    chipText: "text-indigo-700",
    chipBorder: "border-indigo-200",
    wordBgOrig: "bg-indigo-200",
    wordTextOrig: "text-indigo-900",
    wordBgSan: "bg-indigo-300",
    wordTextSan: "text-indigo-900",
    lineNumTint: "text-indigo-400",
  },
  IP_ADDRESS: {
    chipBg: "bg-gray-50",
    chipText: "text-gray-700",
    chipBorder: "border-gray-200",
    wordBgOrig: "bg-gray-200",
    wordTextOrig: "text-gray-900",
    wordBgSan: "bg-gray-300",
    wordTextSan: "text-gray-900",
    lineNumTint: "text-gray-400",
  },
  DOB: {
    chipBg: "bg-teal-50",
    chipText: "text-teal-700",
    chipBorder: "border-teal-200",
    wordBgOrig: "bg-teal-200",
    wordTextOrig: "text-teal-900",
    wordBgSan: "bg-teal-300",
    wordTextSan: "text-teal-900",
    lineNumTint: "text-teal-400",
  },
};

export function getEntityColors(entityType: EntityType): EntityColorSet {
  return colorMap[entityType] ?? colorMap["EMAIL"];
}

// ─── Entity icons ─────────────────────────────────────────────────────────────

const iconMap: Record<EntityType, LucideIcon> = {
  EMAIL: Mail,
  PHONE: Phone,
  AADHAAR: Fingerprint,
  PAN: CreditCard,
  NAME: User,
  ADDRESS: MapPin,
  CARD_NUMBER: CreditCard,
  UPI: Wallet,
  CVV: ShieldAlert,
  PASSPORT: Globe,
  IP_ADDRESS: Globe,
  DOB: Calendar,
};

export function getEntityIcon(entityType: EntityType): LucideIcon {
  return iconMap[entityType] ?? ShieldAlert;
}

// ─── File type icons ──────────────────────────────────────────────────────────

export function getFileIcon(fileType: FileType): LucideIcon {
  if (fileType === "png" || fileType === "jpg") return ImageIcon;
  if (fileType === "sql" || fileType === "csv" || fileType === "json")
    return Database;
  return FileText;
}

// ─── Monospace file types ─────────────────────────────────────────────────────

const monoFileTypes: FileType[] = ["sql", "csv", "json"];

export function isMonoFont(fileType: FileType): boolean {
  return monoFileTypes.includes(fileType);
}

// ─── Confidence bar color ─────────────────────────────────────────────────────

export function getConfidenceColor(confidence: number): string {
  if (confidence > 0.8) return "bg-green-500";
  if (confidence >= 0.5) return "bg-yellow-500";
  return "bg-red-500";
}

// ─── Human-readable layer label ───────────────────────────────────────────────

export function getLayerLabel(layer: string): string {
  const labels: Record<string, string> = {
    regex: "Regex Layer",
    spacy: "spaCy NLP Layer",
    bert: "BERT ML Layer",
  };
  return labels[layer] ?? layer;
}
