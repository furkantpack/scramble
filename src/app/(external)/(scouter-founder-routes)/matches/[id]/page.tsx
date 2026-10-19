import Link from "next/link";
import { notFound } from "next/navigation";

import { ArrowLeft, CircleAlert, MapPin, Radar, WalletCards } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { PageIntro } from "../../_components/founder-ui";
import { getInvestorMatch } from "../matches-data";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = getInvestorMatch(id);
  if (!match) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        eyebrow="Scouter matches · Investor detail"
        title={match.name}
        description={match.whyMatch}
        action={
          <Badge className="border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-700">{match.score}% match</Badge>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <section className="rounded-2xl border bg-white p-6 shadow-xs">
          <h2 className="font-semibold text-lg">Why this investor</h2>
          <p className="mt-2 text-muted-foreground leading-7">{match.whyMatch}</p>
          <div className="mt-7 grid gap-5 border-t pt-6 md:grid-cols-2">
            <DetailBlock title="Why now" text={match.whyNow} />
            <DetailBlock title="Potential concerns" text={match.thingsToKnow} />
            <DetailBlock title="Thesis fit" text={match.themes.join(", ")} />
            <DetailBlock title="Portfolio relevance" text={match.portfolioRelevance} />
          </div>
        </section>
        <aside className="rounded-2xl border bg-white p-5 shadow-xs">
          <h2 className="font-semibold text-lg">Match details</h2>
          <div className="mt-5 space-y-4">
            <Fact icon={Radar} label="Stage" value={match.stage} />
            <Fact icon={MapPin} label="Geography" value={match.geography} />
            <Fact icon={WalletCards} label="Typical check" value={match.checkSize} />
          </div>
          <div className="mt-6 rounded-xl border border-orange-200 bg-orange-50 p-4 text-orange-950 text-sm leading-6">
            <CircleAlert className="mb-2 size-4" /> Match reflects relevance, not investment probability.
          </div>
          <Button asChild variant="outline" className="mt-4 w-full">
            <Link href="/dashboard/founder-dashboard">
              <ArrowLeft /> Back to dashboard
            </Link>
          </Button>
        </aside>
      </div>
    </div>
  );
}

function DetailBlock({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h3 className="font-semibold text-sm">{title}</h3>
      <p className="mt-2 text-muted-foreground text-sm leading-6">{text}</p>
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Radar; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 border-b pb-4 last:border-0 last:pb-0">
      <span className="grid size-9 place-items-center rounded-lg bg-orange-50 text-orange-600">
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="mt-0.5 font-medium text-sm">{value}</p>
      </div>
    </div>
  );
}
