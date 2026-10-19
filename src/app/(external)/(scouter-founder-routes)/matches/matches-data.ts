export type MatchStatus = "recommended" | "saved" | "passed";

export type InvestorMatch = {
  id: string;
  name: string;
  initials: string;
  score: number;
  stage: string;
  geography: string;
  checkSize: string;
  themes: string[];
  whyMatch: string;
  whyNow: string;
  thingsToKnow: string;
  portfolioRelevance: string;
  status: MatchStatus;
  isNew?: boolean;
};

export const investorMatches: InvestorMatch[] = [
  {
    id: "northzone",
    name: "Northzone",
    initials: "NZ",
    score: 94,
    stage: "Seed",
    geography: "Europe / US",
    checkSize: "$500K-$3M",
    themes: ["AI Infrastructure", "Developer Tools"],
    whyMatch:
      "Strong AI infrastructure thesis, relevant portfolio patterns, and a check size that fits your planned round.",
    whyNow: "Your planned Q4 raise and recent traction update increased the relevance of this match.",
    thingsToKnow: "They often enter slightly later than your current stage.",
    portfolioRelevance: "Several technical founder-led companies with infrastructure-led expansion patterns.",
    status: "recommended",
    isNew: true,
  },
  {
    id: "point-nine",
    name: "Point Nine",
    initials: "P9",
    score: 91,
    stage: "Pre-Seed / Seed",
    geography: "Europe",
    checkSize: "$250K-$2M",
    themes: ["B2B Software", "Developer Tools", "SaaS"],
    whyMatch: "Strong history with technical founder-led companies and early B2B software businesses.",
    whyNow: "Your founder-led GTM motion and current company stage align closely with their typical entry point.",
    thingsToKnow: "Their portfolio already contains several adjacent developer-tool companies.",
    portfolioRelevance: "Deep early-stage SaaS pattern recognition and a strong European founder network.",
    status: "recommended",
    isNew: true,
  },
  {
    id: "accel",
    name: "Accel",
    initials: "AC",
    score: 88,
    stage: "Seed",
    geography: "US / Europe",
    checkSize: "$1M-$5M",
    themes: ["AI", "Enterprise Software"],
    whyMatch: "Relevant AI portfolio exposure and a strong founder/company pattern fit.",
    whyNow: "Your fundraising timing is beginning to align with their typical seed entry point.",
    thingsToKnow: "Their average check may be larger than your initial target.",
    portfolioRelevance: "Enterprise software and AI companies with ambitious cross-market growth plans.",
    status: "recommended",
  },
  {
    id: "creandum",
    name: "Creandum",
    initials: "CR",
    score: 86,
    stage: "Seed",
    geography: "Europe",
    checkSize: "$500K-$3M",
    themes: ["SaaS", "AI", "Infrastructure"],
    whyMatch: "Strong European seed fit and relevant portfolio exposure across infrastructure and software.",
    whyNow: "Your current traction and geographic expansion plans make the match more relevant.",
    thingsToKnow: "Fit is stronger if Europe remains a core market.",
    portfolioRelevance: "European category leaders expanding software products into global markets.",
    status: "recommended",
    isNew: true,
  },
  {
    id: "seedcamp",
    name: "Seedcamp",
    initials: "SC",
    score: 84,
    stage: "Pre-Seed / Seed",
    geography: "Europe",
    checkSize: "$300K-$1M",
    themes: ["Software", "AI", "Developer Tools"],
    whyMatch: "Strong stage fit and a track record with technical founders at the earliest company stages.",
    whyNow: "Your company is still within the window where Seedcamp is typically most relevant.",
    thingsToKnow: "The available check may be smaller than your target round.",
    portfolioRelevance: "Technical European founders building software products from the earliest stage.",
    status: "recommended",
  },
];

export function getInvestorMatch(id: string) {
  return investorMatches.find((match) => match.id === id);
}
