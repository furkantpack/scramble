import type { Json, Tables } from "@/types/database";

type Program = Tables<"accelerator_programs">;

export type DeadlineView = {
  label?: string;
  state: "Closes soon" | "Open" | "Rolling" | "Upcoming" | "Closed";
  sortGroup: number;
  sortTime: number;
};

const DAY_MS = 86_400_000;

export function humanize(value: string) {
  const known = {
    idea: "Idea",
    pre_seed: "Pre-Seed",
    seed: "Seed",
    series_a: "Series A",
    later_stage: "Later Stage",
    in_person: "In Person",
  }[value.toLowerCase()];
  if (known) return known;
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatProgramType(value: Program["program_type"]) {
  return {
    accelerator: "Accelerator",
    incubator: "Incubator",
    grant: "Grant",
    venture_program: "Venture Program",
    corporate_program: "Corporate Program",
    other: "Program",
  }[value] as
    | "Accelerator"
    | "Incubator"
    | "Grant"
    | "Venture Program"
    | "Corporate Program"
    | "Program";
}

export function formatProgramLocation(program: Program) {
  const format = {
    remote: "Remote",
    in_person: "In Person",
    hybrid: "Hybrid",
    unknown: "",
  }[program.format];
  const location = program.location?.trim() ?? "";
  if (!location) return format || "Location not specified";
  if (!format || location.toLowerCase().includes(format.toLowerCase())) return location;
  return `${location} · ${format}`;
}

export function formatDeadline(program: Program, now = new Date()): DeadlineView {
  if (program.rolling) return { label: "Rolling", state: "Rolling", sortGroup: 1, sortTime: Number.MAX_SAFE_INTEGER };
  const deadline = program.deadline ? new Date(`${program.deadline}T23:59:59Z`) : null;
  const invalid = deadline && Number.isNaN(deadline.getTime());
  if (program.application_open === false || (deadline && !invalid && deadline.getTime() < now.getTime())) {
    return { label: "Closed", state: "Closed", sortGroup: 3, sortTime: deadline?.getTime() ?? Number.MAX_SAFE_INTEGER };
  }
  if (!deadline || invalid) {
    return program.application_open
      ? { label: "Open", state: "Open", sortGroup: 2, sortTime: Number.MAX_SAFE_INTEGER }
      : { state: "Upcoming", sortGroup: 2, sortTime: Number.MAX_SAFE_INTEGER };
  }
  const days = Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS));
  if (days <= 30) {
    return {
      label: `Closes in ${days} day${days === 1 ? "" : "s"}`,
      state: days <= 7 ? "Closes soon" : "Open",
      sortGroup: 0,
      sortTime: deadline.getTime(),
    };
  }
  return {
    label: `Deadline ${deadline.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    state: "Open",
    sortGroup: 0,
    sortTime: deadline.getTime(),
  };
}

export function formatMoney(amount: number, currency = "USD") {
  const symbol = { USD: "$", EUR: "€", GBP: "£" }[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
  const compact = new Intl.NumberFormat("en-US", { maximumFractionDigits: amount >= 1_000_000 ? 1 : 0, notation: "compact" })
    .format(amount)
    .replace("K", "K")
    .replace("M", "M");
  return `${symbol}${compact}`;
}

export function formatFunding(program: Program) {
  if (program.funding_amount == null) return undefined;
  return `${formatMoney(program.funding_amount, program.funding_currency ?? "USD")} ${program.program_type === "grant" ? "grant" : "investment"}`;
}

export function jsonToStrings(value: Json | undefined): string[] {
  if (value == null) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(jsonToStrings).filter(Boolean);
  return Object.entries(value).flatMap(([key, child]) => {
    if (child == null) return [];
    const text = jsonToStrings(child).join(" · ");
    return text ? [`${humanize(key)}: ${text}`] : [];
  });
}

export function jsonToEligibility(value: Json) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap(jsonToStrings).map((label) => ({ label, state: "unknown" as const }));
  }
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => {
      const text = jsonToStrings(child).join(" · ");
      return text ? [{ label: humanize(key), value: text, state: "unknown" as const }] : [];
    });
  }
  return [{ label: String(value), state: "unknown" as const }];
}

export function sourceUrls(value: Json) {
  return jsonToStrings(value).filter((candidate) => /^https?:\/\//i.test(candidate));
}
