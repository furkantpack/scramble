import { Activity } from "lucide-react";

import { FounderRouteShell } from "../_components/founder-route-shell";

export default function Page() {
  return (
    <FounderRouteShell
      eyebrow="Activity"
      title="Recent movement across your investor map."
      description="Profile changes, new matches, deck feedback, and introduction progress will appear here."
      icon={Activity}
    />
  );
}
