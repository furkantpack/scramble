export function canConfirmCanonicalProfile(membershipRole: string | null | undefined) {
  return membershipRole === "owner";
}
