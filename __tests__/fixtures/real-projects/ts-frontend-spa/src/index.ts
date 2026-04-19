export type { ReactNode } from "react";
export type { Root } from "react-dom/client";

export function formatTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
