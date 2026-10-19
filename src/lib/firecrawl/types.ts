export type ScrapedCompanyPage = {
  url: string;
  title: string | null;
  markdown: string;
  description?: string | null;
};

export type CompanyCrawlResult = {
  rootUrl: string;
  pages: ScrapedCompanyPage[];
  snapshots?: ScrapedCompanyPage[];
  provider: "firecrawl";
  fetchedAt: string;
  strategy: "crawl" | "homepage";
  creditsUsed?: number;
};
