/** Prefer the program's supplied logo, then its own website's brand icon. */
export function programLogoUrl(logoUrl: string | null | undefined, websiteUrl: string | null | undefined) {
  const suppliedLogo = logoUrl?.trim();
  if (suppliedLogo && (/^https?:\/\//i.test(suppliedLogo) || (suppliedLogo.startsWith("/") && !suppliedLogo.startsWith("//")))) return suppliedLogo;
  if (!websiteUrl) return "";

  try {
    const website = new URL(websiteUrl);
    if (website.protocol !== "https:" && website.protocol !== "http:") return "";
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(website.hostname)}&sz=128`;
  } catch {
    return "";
  }
}
