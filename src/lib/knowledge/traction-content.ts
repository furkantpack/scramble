export type TractionDraft = {
  mrr: string;
  arr: string;
  details: string;
};

const MAX_USD_AMOUNT = 1_000_000_000_000;
const MAX_DETAILS_LENGTH = 4_000;

export function emptyTractionDraft(details = ""): TractionDraft {
  return { mrr: "", arr: "", details };
}

export function parseTractionContent(content: string): TractionDraft {
  const mrr = content.match(/^MRR \(USD\): \$([\d,]+(?:\.\d{1,2})?)$/m)?.[1]?.replaceAll(",", "") ?? "";
  const arr = content.match(/^ARR \(USD\): \$([\d,]+(?:\.\d{1,2})?)$/m)?.[1]?.replaceAll(",", "") ?? "";
  const details = content.split(/^Additional traction:\s*$/m)[1]?.trim() ?? (mrr || arr ? "" : content.trim());
  return { mrr, arr, details };
}

export function formatTractionContent(draft: TractionDraft): { content: string } | { error: string } {
  const mrr = parseUsdAmount(draft.mrr);
  const arr = parseUsdAmount(draft.arr);
  if (mrr === undefined || arr === undefined) {
    return { error: "Enter a valid USD amount with up to two decimal places." };
  }
  const details = draft.details.trim();
  if (details.length > MAX_DETAILS_LENGTH) {
    return { error: `Keep additional traction under ${MAX_DETAILS_LENGTH.toLocaleString("en-US")} characters.` };
  }
  if (mrr === null && arr === null && !details) {
    return { error: "Add MRR, ARR, or a traction note before saving." };
  }
  const sections = [
    mrr === null ? null : `MRR (USD): ${formatUsd(mrr)}`,
    arr === null ? null : `ARR (USD): ${formatUsd(arr)}`,
    details ? `Additional traction:\n${details}` : null,
  ];
  return { content: sections.filter(Boolean).join("\n\n") };
}

function parseUsdAmount(raw: string): number | null | undefined {
  const value = raw.trim();
  if (!value) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number <= MAX_USD_AMOUNT ? number : undefined;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}
