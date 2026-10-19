export type SkyvernWebhookPayload = {
  run_id: string;
  status: string;
  output?: unknown;
  screenshot_urls?: string[] | null;
  failure_reason?: string | null;
  errors?: unknown[];
  browser_session_id?: string | null;
  created_at?: string;
  modified_at?: string;
  finished_at?: string | null;
  run_type?: string;
  app_url?: string | null;
  recording_url?: string | null;
  step_count?: number | null;
};

export type SkyvernTaskOutput = {
  ready_for_review?: boolean;
  submitted?: boolean;
  confirmation_text?: string;
  final_url?: string;
  requires_human_input?: boolean;
  human_input_reason?: string;
};
