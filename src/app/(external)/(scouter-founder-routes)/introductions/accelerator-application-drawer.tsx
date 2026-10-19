"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  ExternalLink,
  Eye,
  FileCheck2,
  FileQuestion,
  FileText,
  GraduationCap,
  HandCoins,
  Image as ImageIcon,
  ListChecks,
  MapPin,
  Monitor,
  Pencil,
  Play,
  RotateCcw,
  Send,
  ShieldCheck,
  Target,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  type AutoSubmitAuthorizationView,
  authorizeAutoSubmit,
  type BrowserAgentRunView,
  cancelQueuedBrowserAgentJob,
  discoverApplicationQuestions,
  getApplicationQuestionStatus,
  getAutoSubmitAuthorization,
  getBrowserAgentRun,
  revokeAutoSubmit,
  startBrowserAgentFill,
  submitBrowserAgentApplication,
} from "@/lib/application-agent/client";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { cn } from "@/lib/utils";

import { AcceleratorLogo } from "./accelerator-logo";
import type { Accelerator } from "./interview-library";

type DrawerStep = "overview" | "prepare" | "fill" | "submit";
type PreparationPhase = "idle" | "discovering" | "preparing_answers" | "ready" | "blocked" | "failed";
type QuestionStatus = "ready" | "missing" | "file";
type DrawerQuestion = {
  id: string;
  answerId?: string;
  text: string;
  meta: string;
  status: QuestionStatus;
  answer: string;
  sources: string[];
  fieldType: string;
  required: boolean;
};

export function AcceleratorApplicationDrawer({ accelerator }: { accelerator: Accelerator }) {
  const initialStarted = accelerator.applicationStatus !== "Not started";
  const [step, setStep] = useState<DrawerStep>("overview");
  const [started, setStarted] = useState(initialStarted);
  const [questions, setQuestions] = useState<DrawerQuestion[]>([]);
  const [questionExtractionReady, setQuestionExtractionReady] = useState(false);
  const [verifiedNoQuestions, setVerifiedNoQuestions] = useState(false);
  const [preparationPhase, setPreparationPhase] = useState<PreparationPhase>("idle");
  const [preparationError, setPreparationError] = useState<string>();
  const [answerPreparationProgress, setAnswerPreparationProgress] = useState({ completed: 0, total: 0 });
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deckConfirmed, setDeckConfirmed] = useState(false);
  const [deckAvailable, setDeckAvailable] = useState(false);
  const [fillAttempt, setFillAttempt] = useState(1);
  const [agentProgress, setAgentProgress] = useState(0);
  const [agentResolved, setAgentResolved] = useState(false);
  const [submissionConfirmed, setSubmissionConfirmed] = useState(false);
  const [agentRun, setAgentRun] = useState<BrowserAgentRunView | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [applicationId, setApplicationId] = useState(accelerator.applicationRecordId ?? "");
  const [autoAuthorization, setAutoAuthorization] = useState<AutoSubmitAuthorizationView | null>(null);
  const preparationStartedFor = useRef<string | null>(null);
  let primaryActionLabel = "Start Application";
  if (started) primaryActionLabel = "Continue Application";
  if (!accelerator.applicationUrl) primaryActionLabel = "Application link unavailable";
  if (agentBusy) primaryActionLabel = "Opening…";

  const handlePrimaryAction = () => {
    if (!started) {
      void startApplication();
      return;
    }
    setStep(accelerator.applicationStatus === "Not started" ? "prepare" : initialDrawerStep(accelerator));
  };

  const requiredQuestions = questions.filter((question) => question.required);
  const preparationReady =
    questionExtractionReady &&
    (questions.length > 0
      ? requiredQuestions.every((question) =>
          question.status === "file" ? deckConfirmed : approved.has(question.id) && Boolean(question.answer.trim()),
        )
      : verifiedNoQuestions);
  const startApplication = async () => {
    if (agentBusy) return;
    if (!accelerator.applicationUrl) return toast.error("This program does not have an application URL yet.");
    setAgentBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Your session expired. Please sign in again.");
      const { data: membership, error: membershipError } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", auth.user.id)
        .limit(1)
        .single();
      if (membershipError || !membership) throw new Error("Workspace could not be loaded.");
      const { data: company, error: companyError } = await supabase
        .from("companies")
        .select("id")
        .eq("workspace_id", membership.workspace_id)
        .limit(1)
        .single();
      if (companyError || !company) throw new Error("Company could not be loaded.");
      let resolvedId = applicationId;
      if (!resolvedId) {
        const { data: existing, error: existingError } = await supabase
          .from("accelerator_applications")
          .select("id,status")
          .eq("workspace_id", membership.workspace_id)
          .eq("company_id", company.id)
          .eq("accelerator_program_id", accelerator.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existingError) throw existingError;
        if (existing) resolvedId = existing.id;
      }
      if (!resolvedId) {
        const { data, error } = await supabase
          .from("accelerator_applications")
          .insert({
            workspace_id: membership.workspace_id,
            company_id: company.id,
            accelerator_program_id: accelerator.id,
            program_name_snapshot: accelerator.name,
            form_url: accelerator.applicationUrl,
            deadline_snapshot: accelerator.deadlineDate ?? null,
            status: "draft",
            started_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (error) throw error;
        resolvedId = data.id;
        await supabase.from("audit_logs").insert({
          workspace_id: membership.workspace_id,
          actor_user_id: auth.user.id,
          application_id: data.id,
          action: "application_started",
          to_status: "draft",
          metadata: { accelerator_program_id: accelerator.id },
        });
      }
      setApplicationId(resolvedId);
      setStarted(true);
      setStep("prepare");
    } catch {
      toast.error("The application could not be started. Please try again.");
    } finally {
      setAgentBusy(false);
    }
  };

  const loadApplicationQuestions = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const { data: applicationRecord, error: applicationError } = await supabase
      .from("accelerator_applications")
      .select("company_id")
      .eq("id", applicationId)
      .maybeSingle();
    if (applicationError || !applicationRecord) throw new Error("Application preparation could not be loaded.");
    const [{ data: rows, error: questionsError }, { data: answers, error: answersError }, { data: assets }] =
      await Promise.all([
        supabase.from("application_questions").select("*").eq("application_id", applicationId).order("order_index"),
        supabase.from("application_answers").select("*").eq("application_id", applicationId),
        supabase
          .from("company_assets")
          .select("storage_path,file_name")
          .eq("company_id", applicationRecord.company_id)
          .eq("type", "pitch_deck")
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
    if (questionsError || answersError) throw new Error("Application questions could not be loaded.");
    const answerByQuestion = new Map((answers ?? []).map((answer) => [answer.question_id, answer]));
    const mapped: DrawerQuestion[] = (rows ?? []).map((question) => {
      const answer = answerByQuestion.get(question.id);
      const fileQuestion = question.field_type.toLowerCase().includes("file") || Boolean(answer?.answer_file_path);
      return {
        id: question.id,
        answerId: answer?.id,
        text: question.question_label,
        meta: [
          question.field_type,
          question.required ? "Required" : "Optional",
          question.max_words ? `${question.max_words} words` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        status: fileQuestion ? "file" : answer?.answer_text ? "ready" : "missing",
        answer: answer?.answer_text ?? answer?.answer_file_path ?? (fileQuestion ? (assets?.[0]?.file_name ?? "") : ""),
        sources: Array.isArray(answer?.generated_from)
          ? answer.generated_from.filter((value): value is string => typeof value === "string")
          : [],
        fieldType: question.field_type,
        required: question.required,
      };
    });
    setQuestions(mapped);
    setApproved(
      new Set((answers ?? []).filter((answer) => answer.status === "approved").map((answer) => answer.question_id)),
    );
    setExpanded(mapped[0]?.id ?? null);
    const asset = assets?.[0];
    setDeckAvailable(Boolean(asset));
    return mapped;
  }, [applicationId]);

  const prepareSuggestedAnswers = useCallback(
    async (loadedQuestions: DrawerQuestion[]) => {
      const candidates = loadedQuestions.filter((question) => question.status !== "file" && !question.answerId);
      if (candidates.length === 0) return;
      setPreparationPhase("preparing_answers");
      setAnswerPreparationProgress({ completed: 0, total: candidates.length });
      let completed = 0;
      let failed = 0;
      for (let index = 0; index < candidates.length; index += 2) {
        const batch = candidates.slice(index, index + 2);
        const results = await Promise.allSettled(
          batch.map(async (question) => {
            const response = await fetch(`/api/applications/${applicationId}/questions/${question.id}/suggest`, {
              method: "POST",
            });
            const result = (await response.json().catch(() => ({}))) as { error?: string };
            if (!response.ok) throw new Error(result.error ?? "Suggestion unavailable.");
          }),
        );
        failed += results.filter((result) => result.status === "rejected").length;
        completed += batch.length;
        setAnswerPreparationProgress({ completed, total: candidates.length });
      }
      await loadApplicationQuestions();
      if (failed > 0) {
        setPreparationError(
          `${failed} suggested answer${failed === 1 ? "" : "s"} could not be generated. Add those answers manually.`,
        );
      }
    },
    [applicationId, loadApplicationQuestions],
  );

  const runPreparation = useCallback(
    async (forceDiscovery = false) => {
      if (!applicationId) return;
      setPreparationError(undefined);
      setQuestionExtractionReady(false);
      setVerifiedNoQuestions(false);
      setPreparationPhase("discovering");
      try {
        let extraction = await getApplicationQuestionStatus(applicationId);
        if (forceDiscovery || extraction.phase === "idle") {
          extraction = await discoverApplicationQuestions(applicationId);
        } else if (extraction.phase === "discovering") {
          for (let attempt = 0; attempt < 40 && extraction.phase === "discovering"; attempt++) {
            await new Promise((resolve) => window.setTimeout(resolve, 3_000));
            extraction = await getApplicationQuestionStatus(applicationId);
          }
        }
        if (!extraction.ready) {
          throw new Error(
            extraction.error ??
              (extraction.phase === "discovering"
                ? "Form discovery is still running. Refresh status in a moment."
                : "The complete application form could not be verified."),
          );
        }
        setQuestionExtractionReady(true);
        setVerifiedNoQuestions(extraction.verifiedNoQuestions);
        const loadedQuestions = await loadApplicationQuestions();
        await prepareSuggestedAnswers(loadedQuestions);
        setPreparationPhase("ready");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Application questions could not be extracted.";
        setPreparationError(message);
        setPreparationPhase(
          /login|one-time|captcha|denied|manually|safely inspect/i.test(message) ? "blocked" : "failed",
        );
        toast.error(message);
      }
    },
    [applicationId, loadApplicationQuestions, prepareSuggestedAnswers],
  );

  useEffect(() => {
    if (!applicationId || preparationStartedFor.current === applicationId) return;
    preparationStartedFor.current = applicationId;
    void runPreparation();
  }, [applicationId, runPreparation]);

  const saveAnswer = async (question: DrawerQuestion, value: string, approveAnswer: boolean, evidence?: string[]) => {
    if (!applicationId) return;
    const trimmed = value.trim();
    if (!trimmed) return toast.error("Add an answer before saving.");
    const supabase = getSupabaseBrowserClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return toast.error("Your session expired. Please sign in again.");
    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", auth.user.id)
      .limit(1)
      .single();
    if (membershipError || !membership) return toast.error("Your workspace could not be loaded.");
    const payload = {
      answer_text: trimmed,
      status: approveAnswer ? ("approved" as const) : ("edited" as const),
      approved_by: approveAnswer ? auth.user.id : null,
      approved_at: approveAnswer ? new Date().toISOString() : null,
      generated_from: evidence ?? question.sources,
    };
    let answerId = question.answerId;
    if (answerId) {
      const { error } = await supabase.from("application_answers").update(payload).eq("id", answerId);
      if (error) return toast.error("The answer could not be saved.");
    } else {
      const { data, error } = await supabase
        .from("application_answers")
        .insert({
          ...payload,
          workspace_id: membership.workspace_id,
          application_id: applicationId,
          question_id: question.id,
          generation_metadata: {},
        })
        .select("id")
        .single();
      if (error) return toast.error("The answer could not be saved.");
      answerId = data.id;
    }
    setQuestions((current) =>
      current.map((item) =>
        item.id === question.id
          ? { ...item, answerId, answer: trimmed, status: "ready", sources: evidence ?? question.sources }
          : item,
      ),
    );
    if (approveAnswer) setApproved((current) => new Set([...current, question.id]));
    await supabase.from("audit_logs").insert({
      workspace_id: membership.workspace_id,
      actor_user_id: auth.user.id,
      application_id: applicationId,
      action: approveAnswer ? "answer_approved" : "answer_edited",
      metadata: { question_id: question.id },
    });
    toast.success(approveAnswer ? "Answer approved" : "Answer saved");
  };

  const refreshAgentRun = useCallback(
    async (silent = false) => {
      try {
        if (!applicationId) return null;
        const run = await getBrowserAgentRun(applicationId);
        setAgentRun(run);
        if (run.status === "failed" && run.mode === "fill") setFillAttempt((attempt) => Math.min(3, attempt + 1));
        if (run.mode === "fill") {
          let progress = 1;
          if (run.status === "running" || run.status === "human_input_required") progress = 2;
          if (run.status === "completed" && !run.requiresHumanInput) progress = 3;
          setAgentProgress(progress);
          if (run.status === "completed" && !run.requiresHumanInput) setAgentResolved(true);
        }
        if (run.status === "failed") toast.error(run.error ?? "Browser agent run failed");
        return run;
      } catch (error) {
        if (!silent) toast.error(error instanceof Error ? error.message : "Run status could not be refreshed");
        return null;
      }
    },
    [applicationId],
  );

  useEffect(() => {
    if (applicationId) void refreshAgentRun(true);
  }, [applicationId, refreshAgentRun]);

  useEffect(() => {
    if (!applicationId) return;
    void getAutoSubmitAuthorization(applicationId)
      .then(setAutoAuthorization)
      .catch(() => setAutoAuthorization(null));
  }, [applicationId]);

  const updateAutoAuthorization = async (authorize: boolean) => {
    if (!applicationId || !agentRun || agentRun.mode !== "fill" || agentRun.status !== "completed") return;
    setAgentBusy(true);
    try {
      if (authorize) await authorizeAutoSubmit(applicationId, agentRun.id);
      else await revokeAutoSubmit(applicationId);
      setAutoAuthorization(await getAutoSubmitAuthorization(applicationId));
      toast.success(authorize ? "Program-specific authorization saved" : "Automatic submission authorization revoked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Authorization could not be updated");
    } finally {
      setAgentBusy(false);
    }
  };

  const beginFill = async () => {
    if (!preparationReady || agentBusy) return;
    setAgentBusy(true);
    setStep("fill");
    setAgentProgress(0);
    try {
      if (!applicationId) throw new Error("Start the application first.");
      const run = await startBrowserAgentFill(applicationId, {
        formUrl: accelerator.applicationUrl,
        version: fillAttempt,
        files: deckAvailable && deckConfirmed ? [{ label: "Pitch deck", approved: true }] : [],
      });
      setAgentRun(run);
      setAgentProgress(run.status === "running" ? 2 : 1);
      toast.success("Application fill started", { description: "Submission remains locked until final approval." });
    } catch (error) {
      setStep("prepare");
      setFillAttempt((attempt) => Math.min(3, attempt + 1));
      toast.error(error instanceof Error ? error.message : "Application fill could not start");
    } finally {
      setAgentBusy(false);
    }
  };

  const cancelQueuedJob = async () => {
    if (!applicationId || agentBusy || agentRun?.status !== "queued") return;
    setAgentBusy(true);
    try {
      await cancelQueuedBrowserAgentJob(applicationId);
      await refreshAgentRun();
      toast.success("Queued task cancelled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The task could not be cancelled");
    } finally {
      setAgentBusy(false);
    }
  };

  const submitApplication = async () => {
    if (!submissionConfirmed || agentBusy) return;
    setAgentBusy(true);
    try {
      const run = await submitBrowserAgentApplication(
        applicationId,
        agentRun?.mode === "fill" ? agentRun.id : undefined,
      );
      setAgentRun(run);
      toast.success("Submission started", { description: "The agent is waiting for a real confirmation state." });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Application submission could not start");
    } finally {
      setAgentBusy(false);
    }
  };

  useEffect(() => {
    if (!agentRun || !["queued", "running", "human_input_required"].includes(agentRun.status)) return;
    const timer = window.setTimeout(() => void refreshAgentRun(), 3000);
    return () => window.clearTimeout(timer);
  }, [agentRun, refreshAgentRun]);

  return (
    <div className="min-h-full bg-white">
      <header className="sticky top-0 z-20 border-b bg-white/95 backdrop-blur-md">
        <SheetHeader className="p-5 pr-12 text-left">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <AcceleratorLogo
                logoUrl={accelerator.logoUrl}
                initials={accelerator.initials}
                accent={accelerator.accent}
                className="size-12"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <SheetTitle className="text-xl">{accelerator.name}</SheetTitle>
                  <Badge variant="outline">{accelerator.type}</Badge>
                </div>
                <SheetDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {accelerator.organization && <span>{accelerator.organization}</span>}
                  {accelerator.organization && <span>·</span>}
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" /> {accelerator.location}
                  </span>
                </SheetDescription>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3 xl:justify-end xl:pr-2">
              <Button
                onClick={handlePrimaryAction}
                disabled={agentBusy || !accelerator.applicationUrl}
                className="bg-orange-600 hover:bg-orange-700"
              >
                {primaryActionLabel} <ArrowRight />
              </Button>
              {accelerator.deadline && (
                <div className="flex items-center gap-2 border-l pl-3">
                  <StatusBadge state={accelerator.deadlineState} />
                  <div className="text-right">
                    <p className="font-medium text-sm">{accelerator.deadline}</p>
                    <p className="text-[11px] text-muted-foreground">Application deadline</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-3">
            <span className="text-muted-foreground text-xs">Company fit</span>
            {accelerator.match === undefined ? (
              <span className="text-muted-foreground text-xs">Not scored yet</span>
            ) : (
              <>
                <span className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 font-semibold text-orange-700 text-xs">
                  {accelerator.match}% match
                </span>
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-100">
                  <div className="h-full rounded-full bg-orange-500" style={{ width: `${accelerator.match}%` }} />
                </div>
              </>
            )}
            {started && <span className="ml-auto text-muted-foreground text-xs">{accelerator.applicationStatus}</span>}
          </div>
        </SheetHeader>
      </header>

      <div className="p-5 md:p-6">
        {step !== "overview" && (
          <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => setStep("overview")}>
            <ArrowLeft className="size-4" /> Program overview
          </Button>
        )}
        {step === "overview" && <OverviewState accelerator={accelerator} />}
        {step === "prepare" && (
          <PrepareState
            applicationId={applicationId}
            approved={approved}
            setApproved={setApproved}
            questions={questions}
            expanded={expanded}
            setExpanded={setExpanded}
            deckConfirmed={deckConfirmed}
            deckAvailable={deckAvailable}
            setDeckConfirmed={setDeckConfirmed}
            preparationReady={preparationReady}
            preparationPhase={preparationPhase}
            preparationError={preparationError}
            answerPreparationProgress={answerPreparationProgress}
            verifiedNoQuestions={verifiedNoQuestions}
            onRetryDiscovery={() => void runPreparation(true)}
            onSaveAnswer={(question, value, approveAnswer, evidence) =>
              void saveAnswer(question, value, approveAnswer, evidence)
            }
            onContinue={() => void beginFill()}
          />
        )}
        {step === "fill" && (
          <FillState
            progress={agentProgress}
            resolved={agentResolved}
            questions={questions}
            screenshots={agentRun?.screenshots ?? []}
            status={agentRun?.status}
            currentAction={agentRun?.currentAction}
            liveViewUrl={agentRun?.liveViewUrl}
            runUrl={agentRun?.runUrl}
            recordingUrl={agentRun?.recordingUrl}
            humanInputReason={agentRun?.humanInputReason}
            onResolve={() => void refreshAgentRun()}
            onAdvance={() => void refreshAgentRun()}
            onReview={() => setStep("submit")}
            canCancel={agentRun?.status === "queued" && !agentBusy}
            onCancel={() => void cancelQueuedJob()}
          />
        )}
        {step === "submit" && (
          <SubmitState
            accelerator={accelerator}
            questions={questions}
            confirmed={submissionConfirmed}
            onConfirmed={setSubmissionConfirmed}
            onBack={() => setStep("prepare")}
            pending={agentBusy || (agentRun?.mode === "submit" && ["queued", "running"].includes(agentRun.status))}
            submitted={agentRun?.mode === "submit" && agentRun.applicationState === "SUBMITTED"}
            uncertain={agentRun?.applicationState === "SUBMISSION_UNVERIFIED"}
            screenshots={agentRun?.screenshots ?? []}
            confirmation={agentRun?.submissionEvidence?.confirmationText ?? agentRun?.submissionEvidence?.finalUrl}
            autoAuthorization={autoAuthorization}
            onAutoAuthorize={() => void updateAutoAuthorization(true)}
            onAutoRevoke={() => void updateAutoAuthorization(false)}
            onSubmit={() => void submitApplication()}
          />
        )}
      </div>
    </div>
  );
}

function OverviewState({ accelerator }: { accelerator: Accelerator }) {
  return (
    <div className="divide-y border-y">
      <WorkspaceSection title="Program snapshot" icon={GraduationCap}>
        {accelerator.description && (
          <p className="mb-5 max-w-3xl text-muted-foreground text-sm leading-6">{accelerator.description}</p>
        )}
        <FactGrid
          facts={[
            ["Program", accelerator.type],
            ["Location", accelerator.program.location],
            ["Format", accelerator.program.format],
            ["Duration", accelerator.program.duration],
            ["Cohort", accelerator.program.cohort],
            ["Deadline", accelerator.deadline],
            ["Start date", accelerator.program.starts],
          ]}
        />
      </WorkspaceSection>

      {accelerator.match !== undefined && (
        <WorkspaceSection
          title="Why this matches"
          icon={Target}
          description={`${accelerator.match}% company fit based on available program and company information.`}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {accelerator.matchReasons.length > 0 && (
              <SignalCard title="Strong signals" tone="positive" items={accelerator.matchReasons} />
            )}
            {accelerator.gaps.length > 0 && (
              <SignalCard title="Things to check" tone="warning" items={accelerator.gaps} />
            )}
          </div>
        </WorkspaceSection>
      )}

      {accelerator.terms.length > 0 && (
        <WorkspaceSection title="Funding & Terms" icon={HandCoins}>
          <div className="grid divide-y border-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {accelerator.terms.map((term) => (
              <div key={term.label} className="px-4 py-3 first:pl-0 last:pr-0">
                <p className="text-muted-foreground text-xs">{term.label}</p>
                <p className="mt-1 font-semibold text-sm leading-5">{term.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-muted-foreground text-xs">
            Terms are never inferred when the program has not disclosed them.
          </p>
        </WorkspaceSection>
      )}

      {(accelerator.criteria.length > 0 || accelerator.thesis.length > 0) && (
        <WorkspaceSection title="What they look for" icon={Target}>
          <FactGrid facts={accelerator.criteria.map((item) => [item.label, item.value])} />
          {accelerator.thesis.length > 0 && (
            <div className="mt-5 border-t pt-4">
              <SignalList items={accelerator.thesis} tone="neutral" />
            </div>
          )}
        </WorkspaceSection>
      )}

      <div className="flex flex-col gap-3 py-5 text-muted-foreground text-xs sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p>
            <span className="font-medium text-foreground">Last verified</span> · {accelerator.verified}
          </p>
          <p className="mt-1">Sources · Official program website · Application page</p>
        </div>
        <div className="flex gap-2">
          {accelerator.websiteUrl && (
            <Button asChild variant="ghost" size="sm">
              <a href={accelerator.websiteUrl} target="_blank" rel="noopener noreferrer">
                Visit Program <ExternalLink />
              </a>
            </Button>
          )}
          {accelerator.sourceUrls?.map((url, index) => (
            <Button key={url} asChild variant="ghost" size="sm">
              <a href={url} target="_blank" rel="noopener noreferrer">
                Source {index + 1} <ExternalLink />
              </a>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PrepareState({
  applicationId,
  approved,
  setApproved,
  questions,
  expanded,
  setExpanded,
  deckConfirmed,
  deckAvailable,
  setDeckConfirmed,
  preparationReady,
  preparationPhase,
  preparationError,
  answerPreparationProgress,
  verifiedNoQuestions,
  onRetryDiscovery,
  onSaveAnswer,
  onContinue,
}: {
  applicationId: string;
  approved: Set<string>;
  setApproved: (value: Set<string>) => void;
  questions: DrawerQuestion[];
  expanded: string | null;
  setExpanded: (value: string | null) => void;
  deckConfirmed: boolean;
  deckAvailable: boolean;
  setDeckConfirmed: (value: boolean) => void;
  preparationReady: boolean;
  preparationPhase: PreparationPhase;
  preparationError?: string;
  answerPreparationProgress: { completed: number; total: number };
  verifiedNoQuestions: boolean;
  onRetryDiscovery: () => void;
  onSaveAnswer: (question: DrawerQuestion, value: string, approve: boolean, evidence?: string[]) => void;
  onContinue: () => void;
}) {
  const completed = approved.size + Number(deckConfirmed);
  const approveReady = () => {
    const ready = questions.filter((question) => question.status === "ready" && question.answer.trim());
    setApproved(new Set([...approved, ...ready.map((question) => question.id)]));
    for (const question of ready) onSaveAnswer(question, question.answer, true);
    toast.success("Ready answers approved", { description: "Only complete, constraint-safe answers were approved." });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-orange-600 text-sm">Prepare application</p>
          <h2 className="mt-1 font-semibold text-2xl">
            {preparationPhase === "discovering"
              ? "Discovering the application form"
              : preparationPhase === "preparing_answers"
                ? `Preparing answers · ${answerPreparationProgress.completed}/${answerPreparationProgress.total}`
                : preparationPhase === "blocked" || preparationPhase === "failed"
                  ? "Application preparation needs attention"
                  : verifiedNoQuestions
                    ? "No applicant questions on the verified form"
                    : `${questions.length} questions detected`}
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">
            {preparationPhase === "discovering"
              ? "Scramble is inspecting the official application URL and safely following non-submission steps."
              : preparationPhase === "preparing_answers"
                ? "Scramble is drafting suggestions from your founder-confirmed startup profile."
                : "Review suggested answers, resolve missing information, and confirm required files."}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={approveReady}
          disabled={questions.length === 0 || preparationPhase !== "ready"}
        >
          <ListChecks /> Approve ready answers
        </Button>
      </div>

      <div className="grid border-y py-4 sm:grid-cols-3">
        <MetricCard value={String(approved.size)} label="Approved" tone="text-emerald-700" />
        <MetricCard
          value={String(questions.filter((question) => question.status === "missing").length)}
          label="Need input"
          tone="text-amber-700"
        />
        <MetricCard
          value={String(questions.filter((question) => question.status === "file" && !deckConfirmed).length)}
          label="File required"
          tone="text-violet-700"
        />
      </div>

      {preparationPhase === "ready" && preparationError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
          {preparationError}
        </div>
      ) : null}

      <div className="border-y">
        {questions.map((question) => (
          <QuestionCard
            key={question.id}
            applicationId={applicationId}
            question={question}
            expanded={expanded === question.id}
            approved={approved.has(question.id)}
            onToggle={() => setExpanded(expanded === question.id ? null : question.id)}
            onSave={(value, approveAnswer, evidence) => onSaveAnswer(question, value, approveAnswer, evidence)}
            deckConfirmed={deckConfirmed}
            deckAvailable={deckAvailable}
            setDeckConfirmed={setDeckConfirmed}
          />
        ))}
        {questions.length === 0 && preparationPhase === "discovering" ? (
          <div className="p-8 text-center">
            <Circle className="mx-auto size-6 animate-pulse fill-orange-500 text-orange-500" />
            <p className="mt-3 font-medium text-sm">Discovering form fields and questions</p>
            <p className="mt-1 text-muted-foreground text-xs">This can take up to two minutes for multi-step forms.</p>
          </div>
        ) : null}
        {questions.length === 0 && preparationPhase === "preparing_answers" ? (
          <div className="p-8 text-center">
            <Circle className="mx-auto size-6 animate-pulse fill-violet-500 text-violet-500" />
            <p className="mt-3 font-medium text-sm">Preparing suggested answers</p>
          </div>
        ) : null}
        {questions.length === 0 && preparationPhase === "ready" && verifiedNoQuestions ? (
          <div className="p-8 text-center">
            <CheckCircle2 className="mx-auto size-6 text-emerald-600" />
            <p className="mt-3 font-medium text-sm">Complete form inspected</p>
            <p className="mt-1 text-muted-foreground text-xs">
              The official application flow was verified and contains no applicant questions.
            </p>
          </div>
        ) : null}
        {questions.length === 0 && (preparationPhase === "blocked" || preparationPhase === "failed") ? (
          <div className="p-8 text-center">
            <AlertTriangle className="mx-auto size-6 text-amber-600" />
            <p className="mt-3 font-medium text-sm">Form discovery did not complete</p>
            <p className="mx-auto mt-1 max-w-lg text-muted-foreground text-xs">{preparationError}</p>
            <Button className="mt-4" variant="outline" onClick={onRetryDiscovery}>
              Retry form discovery
            </Button>
          </div>
        ) : null}
      </div>

      <div className="sticky bottom-0 border-t bg-white/95 p-4 shadow-[0_-8px_24px_-20px_rgba(0,0,0,0.35)] backdrop-blur-md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-sm">
              {preparationPhase === "discovering"
                ? "Discovering the form before browser fill"
                : preparationPhase === "preparing_answers"
                  ? "Preparing suggested answers"
                  : preparationPhase === "blocked" || preparationPhase === "failed"
                    ? "Form discovery must succeed before filling"
                    : preparationReady
                      ? "Application ready to fill"
                      : `${Math.max(0, questions.length - completed)} items still need attention`}
            </p>
            <p className="text-muted-foreground text-xs">
              Saved required answers must be approved before the agent can continue. The final submission remains a
              separate action.
            </p>
          </div>
          <Button disabled={!preparationReady} onClick={onContinue} className="bg-orange-600 hover:bg-orange-700">
            Continue to Fill <ArrowRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

function QuestionCard({
  applicationId,
  question,
  expanded,
  approved,
  onToggle,
  onSave,
  deckConfirmed,
  deckAvailable,
  setDeckConfirmed,
}: {
  applicationId: string;
  question: DrawerQuestion;
  expanded: boolean;
  approved: boolean;
  onToggle: () => void;
  onSave: (value: string, approve: boolean, evidence?: string[]) => void;
  deckConfirmed: boolean;
  deckAvailable: boolean;
  setDeckConfirmed: (value: boolean) => void;
}) {
  const status = approved
    ? "Approved"
    : question.status === "ready"
      ? "Ready from Knowledge Base"
      : question.status === "missing"
        ? "Missing information"
        : deckConfirmed
          ? "File confirmed"
          : "File confirmation required";
  return (
    <article className="overflow-hidden border-b bg-white last:border-b-0">
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-4 p-4 text-left">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-zinc-100 font-semibold text-xs">
          {question.id.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-sm">{question.text}</h3>
          <p className="mt-1 text-muted-foreground text-xs">{question.meta}</p>
          <StatusPill status={status} />
        </div>
        <ChevronDown
          className={cn("mt-1 size-4 text-muted-foreground transition-transform", expanded && "rotate-180")}
        />
      </button>
      {expanded && (
        <div className="border-t bg-zinc-50/60 p-4">
          {question.status !== "file" && (
            <SuggestedAnswer applicationId={applicationId} question={question} approved={approved} onSave={onSave} />
          )}
          {question.status === "file" && (
            <div className="rounded-xl border bg-white p-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-lg bg-red-50">
                  <FileText className="size-5 text-red-600" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">{question.answer}</p>
                  <p className="text-muted-foreground text-xs">PDF · Founder assets</p>
                </div>
                {deckConfirmed && <CheckCircle2 className="size-5 text-emerald-600" />}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  disabled={!deckAvailable}
                  onClick={() => setDeckConfirmed(true)}
                  className="bg-orange-600 hover:bg-orange-700"
                >
                  Use this file
                </Button>
                <Button variant="outline" onClick={() => toast("File picker preview")}>
                  <Upload /> Choose another
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function SuggestedAnswer({
  applicationId,
  question,
  approved,
  onSave,
}: {
  applicationId: string;
  question: DrawerQuestion;
  approved: boolean;
  onSave: (value: string, approve: boolean, evidence?: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(question.answer);
  const [suggesting, setSuggesting] = useState(false);
  const [clarification, setClarification] = useState<string[]>([]);
  const [hasProposal, setHasProposal] = useState(false);
  const [suggestionEvidence, setSuggestionEvidence] = useState<string[]>([]);
  useEffect(() => {
    setValue(question.answer);
  }, [question.answer]);
  const suggest = async () => {
    if (!applicationId || suggesting) return;
    setSuggesting(true);
    try {
      const response = await fetch(`/api/applications/${applicationId}/questions/${question.id}/suggest`, {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Suggestion unavailable.");
      setClarification(result.missingInformation ?? []);
      setSuggestionEvidence(Array.isArray(result.evidence) ? result.evidence : []);
      if (result.answer) {
        setValue(result.answer);
        setEditing(true);
        setHasProposal(true);
      } else toast("More founder information is needed for this answer.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Suggestion unavailable.");
    } finally {
      setSuggesting(false);
    }
  };
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-sm">Suggested Answer</p>
        {approved && !hasProposal && (
          <Badge className="bg-emerald-50 text-emerald-700">
            <Check /> Approved
          </Badge>
        )}
      </div>
      {editing ? (
        <Textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="mt-3 min-h-32 resize-none leading-6"
        />
      ) : (
        <p className="mt-3 text-sm leading-7">
          {value || "No answer yet. Generate a suggestion or enter founder-approved information."}
        </p>
      )}
      {clarification.length > 0 && (
        <p className="mt-2 text-amber-700 text-xs">Needs clarification: {clarification.join(" · ")}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div>
          <p className="text-muted-foreground text-xs">{value.split(/\s+/).length} / 150 words</p>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="text-muted-foreground text-xs">Based on</span>
            {question.sources.map((source) => (
              <Badge key={source} variant="outline" className="text-[10px]">
                {source}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (editing) {
                onSave(value, false, hasProposal ? suggestionEvidence : undefined);
                setHasProposal(false);
              }
              setEditing(!editing);
            }}
          >
            <Pencil /> {editing ? "Save" : "Edit"}
          </Button>
          <Button size="sm" variant="ghost" disabled={suggesting || !applicationId} onClick={() => void suggest()}>
            <RotateCcw /> {suggesting ? "Generating…" : "Regenerate"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!value.trim()}
            onClick={() => {
              onSave(value, true, hasProposal ? suggestionEvidence : undefined);
              setHasProposal(false);
            }}
          >
            <Check /> Approve
          </Button>
        </div>
      </div>
    </div>
  );
}

function FillState({
  progress,
  resolved,
  questions,
  screenshots,
  status,
  currentAction,
  liveViewUrl,
  runUrl,
  recordingUrl,
  humanInputReason,
  onResolve,
  onAdvance,
  onReview,
  canCancel,
  onCancel,
}: {
  progress: number;
  resolved: boolean;
  questions: DrawerQuestion[];
  screenshots: string[];
  status?: BrowserAgentRunView["status"];
  currentAction?: string;
  liveViewUrl?: string;
  runUrl?: string;
  recordingUrl?: string;
  humanInputReason?: string;
  onResolve: () => void;
  onAdvance: () => void;
  onReview: () => void;
  canCancel?: boolean;
  onCancel: () => void;
}) {
  const activities = ["Skyvern run queued", "Skyvern browser running", "Form reported ready for review"];
  const completed = Math.min(progress, activities.length);
  return (
    <div className="space-y-6">
      <div className="border-b pb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Badge className="bg-violet-100 text-violet-700">
                <Bot /> Agent working
              </Badge>
              <Badge variant="outline">Approved answers only</Badge>
            </div>
            <h2 className="mt-3 font-semibold text-2xl">Filling your application</h2>
            <p className="mt-1 text-muted-foreground text-sm">
              Skyvern is using the founder-confirmed profile and approved answers.
            </p>
          </div>
          <p className="font-medium text-sm">
            {completed === 3 ? "Ready for your review" : "Waiting for Skyvern status"}
          </p>
        </div>
        <Progress value={(completed / activities.length) * 100} className="mt-5 h-2" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <section className="xl:border-r xl:pr-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Live activity</h3>
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={onAdvance}>
                <Play /> Refresh status
              </Button>
              {canCancel && (
                <Button size="sm" variant="outline" onClick={onCancel}>
                  Cancel queued task
                </Button>
              )}
            </div>
          </div>
          <div className="mt-4 rounded-xl border bg-zinc-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-sm">{currentAction ?? "Waiting for live browser details"}</p>
                <p className="mt-0.5 text-muted-foreground text-xs">
                  Status: {status?.replaceAll("_", " ") ?? "starting"}
                </p>
              </div>
              {liveViewUrl ? (
                <Button asChild size="sm" className="bg-violet-600 hover:bg-violet-700">
                  <a href={liveViewUrl} target="_blank" rel="noopener noreferrer">
                    <Eye /> Watch Agent Live
                  </a>
                </Button>
              ) : runUrl ? (
                <Button asChild size="sm" variant="outline">
                  <a href={runUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink /> Open Skyvern Run
                  </a>
                </Button>
              ) : null}
            </div>
            {!liveViewUrl && status && ["queued", "running", "human_input_required"].includes(status) ? (
              <p className="mt-2 text-amber-700 text-xs">
                Skyvern has not returned a live-session URL yet. Status polling will keep checking.
              </p>
            ) : null}
          </div>
          <div className="mt-5 space-y-1">
            {activities.map((activity, index) => {
              const done = index < completed;
              const active = index === completed && completed < activities.length;
              return (
                <div
                  key={activity}
                  className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm", active && "bg-violet-50")}
                >
                  {done ? (
                    <CheckCircle2 className="size-4 text-emerald-600" />
                  ) : active ? (
                    <Circle className="size-4 animate-pulse fill-violet-500 text-violet-500" />
                  ) : (
                    <Circle className="size-4 text-zinc-300" />
                  )}
                  <span className={cn(!done && !active && "text-muted-foreground")}>{activity}</span>
                </div>
              );
            })}
          </div>
        </section>
        <section className="overflow-hidden border">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <p className="font-medium text-sm">Agent preview</p>
              <p className="text-muted-foreground text-xs">Only provider-returned evidence is shown.</p>
            </div>
            <div className="flex items-center gap-3">
              {recordingUrl && (
                <a
                  className="text-orange-700 text-xs underline"
                  href={recordingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open recording
                </a>
              )}
              {screenshots[0] && (
                <a
                  className="text-orange-700 text-xs underline"
                  href={screenshots[0]}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open screenshot
                </a>
              )}
            </div>
          </div>
          <div className="grid min-h-[360px] place-items-center bg-zinc-100 p-6">
            <p className="max-w-sm text-center text-muted-foreground text-sm">
              {screenshots.length
                ? "Open the provider screenshot to inspect the current form."
                : "No provider screenshot is available yet. Refresh the run status to check progress."}
            </p>
          </div>
        </section>
      </div>

      {humanInputReason && !resolved && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 text-amber-600" />
            <div className="flex-1">
              <p className="font-semibold">Action required</p>
              <p className="mt-1 text-sm">
                The browser agent paused because human input is required: {humanInputReason.replaceAll("_", " ")}.
              </p>
              <Button className="mt-4" size="sm" onClick={onResolve}>
                Check portal, then refresh status
              </Button>
            </div>
          </div>
        </section>
      )}

      <section className="border-y py-5">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => toast("Field mapping details expanded")}
        >
          <div>
            <h3 className="font-semibold">Filled fields</h3>
            <p className="mt-1 text-muted-foreground text-xs">Inspect how Knowledge Base fields map to this form.</p>
          </div>
          <ChevronDown className="size-4" />
        </button>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {questions.slice(0, 3).map((question) => (
            <MappingField
              key={question.id}
              label={question.text}
              value={question.answer || "—"}
              status={question.answer ? "Matched" : "Needs review"}
            />
          ))}
        </div>
      </section>

      {progress >= 3 && resolved && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Badge className="bg-white text-zinc-700">Not submitted yet</Badge>
              <h3 className="mt-3 font-semibold text-xl">Application filled</h3>
              <p className="mt-1 text-emerald-900/70 text-sm">
                Skyvern reported the form ready for review. Inspect the external form before submission.
              </p>
            </div>
            <Button onClick={onReview} className="bg-orange-600 hover:bg-orange-700">
              Review Filled Application <ArrowRight />
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function SubmitState({
  accelerator,
  questions,
  confirmed,
  onConfirmed,
  onBack,
  pending,
  submitted,
  uncertain,
  screenshots,
  confirmation,
  autoAuthorization,
  onAutoAuthorize,
  onAutoRevoke,
  onSubmit,
}: {
  accelerator: Accelerator;
  questions: DrawerQuestion[];
  confirmed: boolean;
  onConfirmed: (value: boolean) => void;
  onBack: () => void;
  pending?: boolean;
  submitted?: boolean;
  uncertain?: boolean;
  screenshots: string[];
  confirmation?: string;
  autoAuthorization: AutoSubmitAuthorizationView | null;
  onAutoAuthorize: () => void;
  onAutoRevoke: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Badge
            variant="outline"
            className={
              submitted
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            }
          >
            {submitted ? "Submitted" : uncertain ? "Submission unverified" : pending ? "Submitting" : "Not submitted"}
          </Badge>
          <h2 className="mt-3 font-semibold text-2xl">Review before submission</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            Review the completed application before AcceleratorPilot submits anything externally.
          </p>
        </div>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft /> Edit answers
        </Button>
      </div>

      <WorkspaceSection title="Filled application" icon={FileCheck2}>
        {questions
          .filter((question) => question.answer)
          .map((question) => (
            <ReviewAnswer
              key={question.id}
              title={question.text}
              text={question.answer}
              words={question.answer.split(/\s+/).filter(Boolean).length}
            />
          ))}
        {questions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No saved application answers are available.</p>
        ) : null}
      </WorkspaceSection>

      <WorkspaceSection title="Agent check" icon={ShieldCheck}>
        <p className="text-muted-foreground text-sm">
          The browser run reported the form ready for review. Check the external portal for declarations, uploads, and
          any fields Skyvern could not verify.
        </p>
        {uncertain && (
          <p className="mt-2 text-amber-700 text-sm">
            The submission outcome is unknown. Check the program portal before taking another action.
          </p>
        )}
        {submitted && confirmation && <p className="mt-2 text-emerald-700 text-sm">Confirmation: {confirmation}</p>}
      </WorkspaceSection>

      <WorkspaceSection
        title="Form Preview"
        icon={Monitor}
        description="Final screenshots from the filled external form."
      >
        {screenshots.length ? (
          <div className="flex flex-wrap gap-2">
            {screenshots.slice(0, 4).map((url, index) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border px-3 py-2 text-orange-700 text-sm"
              >
                Screenshot {index + 1}
              </a>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No provider screenshots are available yet.</p>
        )}
      </WorkspaceSection>

      <section className="rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-violet-50 p-5 shadow-xs">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-orange-100">
            <Send className="size-5 text-orange-700" />
          </span>
          <div>
            <h3 className="font-semibold text-xl">Ready to submit</h3>
            <p className="mt-1 max-w-2xl text-muted-foreground text-sm leading-6">
              AcceleratorPilot will submit this application to {accelerator.name} only after your explicit confirmation.
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border bg-white p-4">
          <span>
            <span className="block font-medium text-sm">I reviewed the completed application</span>
            <span className="text-muted-foreground text-xs">
              I confirm the information is accurate and ready for external submission.
            </span>
          </span>
          <Switch aria-label="Confirm application review" checked={confirmed} onCheckedChange={onConfirmed} />
        </div>
        <Button
          disabled={
            !confirmed ||
            Boolean(pending) ||
            Boolean(submitted) ||
            Boolean(uncertain) ||
            Boolean(autoAuthorization?.authorized) ||
            Boolean(autoAuthorization?.dispatched)
          }
          className="mt-4 w-full bg-orange-600 hover:bg-orange-700"
          onClick={onSubmit}
        >
          <Send /> {submitted ? "Application Submitted" : pending ? "Submitting…" : "Submit Application"}
        </Button>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Submission runs only after this separate confirmation and never starts automatically after filling.
        </p>
      </section>
      {(autoAuthorization?.enabled || autoAuthorization?.authorized) && !submitted && !uncertain && (
        <section className="rounded-xl border p-4">
          <h3 className="font-medium text-sm">Authorized automatic submission</h3>
          <p className="mt-1 text-muted-foreground text-xs">
            Optional and scoped only to this program and reviewed fill. You can revoke it until dispatch begins.
          </p>
          {autoAuthorization.dispatched ? (
            <p className="mt-3 text-amber-700 text-sm">
              Dispatch started; check the live status before any other action.
            </p>
          ) : autoAuthorization.authorized ? (
            <Button className="mt-3" size="sm" variant="outline" onClick={onAutoRevoke}>
              Revoke authorization
            </Button>
          ) : autoAuthorization?.enabled ? (
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              disabled={!confirmed || Boolean(pending)}
              onClick={onAutoAuthorize}
            >
              Authorize this program
            </Button>
          ) : (
            <p className="mt-3 text-muted-foreground text-xs">Automatic submission is disabled for this deployment.</p>
          )}
        </section>
      )}
    </div>
  );
}

function WorkspaceSection({
  title,
  icon: Icon,
  description,
  children,
}: {
  title: string;
  icon: typeof Target;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-6 first:pt-2 last:pb-2">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-zinc-100">
          <Icon className="size-4" />
        </span>
        <div>
          <h2 className="font-semibold text-lg">{title}</h2>
          {description && <p className="mt-0.5 text-muted-foreground text-xs">{description}</p>}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SignalCard({ title, tone, items }: { title: string; tone: "positive" | "warning"; items: string[] }) {
  return (
    <div className={cn("border-l-2 py-1 pl-4", tone === "positive" ? "border-emerald-400" : "border-amber-400")}>
      <p className="font-medium text-sm">{title}</p>
      <div className="mt-3">
        <SignalList items={items} tone={tone} />
      </div>
    </div>
  );
}

function SignalList({ items, tone }: { items: string[]; tone: "positive" | "warning" | "neutral" }) {
  const config = {
    positive: { icon: CheckCircle2, color: "text-emerald-600" },
    warning: { icon: AlertTriangle, color: "text-amber-600" },
    neutral: { icon: Check, color: "text-zinc-500" },
  }[tone];
  const Icon = config.icon;
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm leading-6">
          <Icon className={cn("mt-1 size-3.5 shrink-0", config.color)} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function FactGrid({ facts }: { facts: [string, string | undefined][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {facts
        .filter((item): item is [string, string] => Boolean(item[1]))
        .map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="mt-1 font-medium text-sm">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function StatusBadge({ state }: { state: Accelerator["deadlineState"] }) {
  const style = {
    "Closes soon": "border-rose-200 bg-rose-50 text-rose-700",
    Open: "border-emerald-200 bg-emerald-50 text-emerald-700",
    Rolling: "border-sky-200 bg-sky-50 text-sky-700",
    Upcoming: "border-violet-200 bg-violet-50 text-violet-700",
    Closed: "border-zinc-200 bg-zinc-100 text-zinc-600",
  }[state];
  return (
    <Badge variant="outline" className={style}>
      {state}
    </Badge>
  );
}

function MetricCard({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <div className="border-l px-4 first:border-l-0 first:pl-0">
      <p className={cn("font-semibold text-2xl", tone)}>{value}</p>
      <p className="mt-1 text-muted-foreground text-xs">{label}</p>
    </div>
  );
}
function StatusPill({ status }: { status: string }) {
  const tone =
    status === "Approved" || status === "File confirmed"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status.includes("Missing") || status.includes("required")
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-violet-200 bg-violet-50 text-violet-700";
  return (
    <Badge variant="outline" className={cn("mt-2", tone)}>
      {status}
    </Badge>
  );
}
function PreviewField({
  label,
  value,
  active,
  warning,
}: {
  label: string;
  value: string;
  active?: boolean;
  warning?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] text-zinc-500">{label}</p>
      <div
        className={cn(
          "mt-1 min-h-8 rounded-md border px-2.5 py-2 text-xs",
          active && "border-violet-400 ring-2 ring-violet-100",
          warning && "border-amber-300 bg-amber-50 text-amber-700",
        )}
      >
        {value}
      </div>
    </div>
  );
}
function MappingField({ label, value, status }: { label: string; value: string; status: string }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-medium text-sm">{value}</p>
      <Badge
        variant="outline"
        className={cn(
          "mt-2 text-[10px]",
          status === "Matched" ? "border-emerald-200 text-emerald-700" : "border-amber-200 text-amber-700",
        )}
      >
        {status}
      </Badge>
    </div>
  );
}
function ReviewAnswer({ title, text, words }: { title: string; text: string; words: number }) {
  return (
    <div className="border-b py-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        <Button size="sm" variant="ghost">
          <Pencil /> Edit
        </Button>
      </div>
      <p className="mt-3 text-sm leading-7">{text}</p>
      <p className="mt-2 text-muted-foreground text-xs">{words} words</p>
    </div>
  );
}
function ScreenshotCard({ label, index }: { label: string; index: string }) {
  return (
    <button
      type="button"
      onClick={() => toast(`Preview ${index} enlarged`)}
      className="group overflow-hidden rounded-xl border bg-zinc-100 text-left"
    >
      <div className="grid aspect-video place-items-center bg-gradient-to-br from-zinc-100 to-zinc-200">
        <div className="text-center">
          <ImageIcon className="mx-auto size-6 text-zinc-400" />
          <p className="mt-2 text-xs text-zinc-500">Filled form screenshot {index}</p>
        </div>
      </div>
      <div className="flex items-center justify-between bg-white px-3 py-2.5">
        <span className="font-medium text-sm">{label}</span>
        <Eye className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </div>
    </button>
  );
}

function initialDrawerStep(accelerator: Accelerator): DrawerStep {
  if (["submitted", "submitting", "submission_unverified"].includes(accelerator.rawApplicationStatus ?? ""))
    return "submit";
  if (accelerator.rawApplicationStatus === "agent_filled_pending_final_approval") return "submit";
  if (accelerator.rawApplicationStatus === "agent_filling") return "fill";
  return accelerator.applicationStatus === "Not started" ? "overview" : "prepare";
}
