import { d, units } from "@/domain/sliceCalculation/math";

import type { CalibrationState } from "./types";

export interface CoachCalculation {
  id: string;
  contributionUnits: string | number;
}

export interface CoachReview {
  resultingState: Exclude<CalibrationState, "provisional">;
  confirmedUnits: string | number | null;
}

export function summarizeContributionStates(
  calculations: CoachCalculation[],
  latestReviews: ReadonlyMap<string, CoachReview>,
  vestedUnits: string | number,
) {
  let provisional = d(0);
  let confirmed = d(0);
  let pendingCalibration = 0;
  let disputed = 0;

  for (const calculation of calculations) {
    const review = latestReviews.get(calculation.id);
    if (!review) {
      provisional = provisional.plus(calculation.contributionUnits);
      pendingCalibration += 1;
    } else if (review.resultingState === "disputed") {
      disputed += 1;
    } else {
      confirmed = confirmed.plus(review.confirmedUnits ?? 0);
    }
  }

  return {
    provisionalUnits: units(provisional),
    confirmedUnits: units(confirmed),
    vestedUnits: units(vestedUnits),
    pendingCalibration,
    disputed,
  };
}
