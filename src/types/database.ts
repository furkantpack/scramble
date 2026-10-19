export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      scrape_snapshots: Table<{
        id: string; workspace_id: string; company_id: string | null; source_url: string;
        raw_markdown: string | null; raw_json: Json | null; fetched_at: string;
      }>;
      usage_counters: Table<{
        workspace_id: string; firecrawl_calls_this_month: number; llm_input_tokens_this_month: number;
        llm_output_tokens_this_month: number; browser_agent_runs_this_month: number;
        period_start: string; updated_at: string;
      }>;
      profiles: Table<{
        id: string;
        role: "founder" | "investor" | "admin";
        email: string | null;
        created_at: string;
        updated_at: string;
      }>;
      workspaces: Table<{
        id: string;
        owner_id: string;
        name: string;
        created_at: string;
        updated_at: string;
        deleted_at: string | null;
      }>;
      workspace_members: Table<{
        id: string;
        workspace_id: string;
        user_id: string;
        role: "owner" | "member";
        created_at: string;
      }>;
      founder_profiles: Table<{
        id: string;
        workspace_id: string;
        user_id: string;
        first_name: string;
        last_name: string;
        linkedin_url: string | null;
        anything_else_scouter_should_know: string | null;
        onboarding_completed: boolean;
        onboarding_completed_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      companies: Table<{
        id: string;
        workspace_id: string;
        name: string;
        website_url: string | null;
        stage: Database["public"]["Enums"]["company_stage"];
        sector: string | null;
        short_description: string | null;
        unified_analysis: Json | null;
        canonical_profile: Json | null;
        profile_confirmed_at: string | null;
        profile_confirmed_by: string | null;
        logo_url: string | null;
        created_at: string;
        updated_at: string;
      }>;
      app_users: Table<{
        id: string;
        auth_user_id: string | null;
        company_id: string;
        name: string;
        email: string;
        role: "founder_admin" | "team_lead" | "contributor" | "viewer_investor";
        status: string;
        external_jira_account_id: string | null;
        current_ownership_percent: number | null;
        benchmark_role: string | null;
        created_at: string;
      }>;
      founder_needs: Table<{
        id: string;
        workspace_id: string;
        founder_profile_id: string;
        need: Database["public"]["Enums"]["founder_need"];
        created_at: string;
      }>;
      company_assets: Table<{
        id: string;
        workspace_id: string;
        company_id: string;
        type: "pitch_deck" | "demo_video" | "application_file" | "other";
        file_name: string | null;
        storage_path: string;
        mime_type: string | null;
        file_size_bytes: number | null;
        content_sha256: string | null;
        analysis_status: "uploaded" | "processing" | "processed" | "failed" | null;
        extracted_text: string | null;
        extracted_json: Json | null;
        extracted_pages: Json | null;
        analysis_error: string | null;
        processed_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      accelerator_programs: Table<{
        id: string;
        slug: string | null;
        name: string;
        operator_name: string | null;
        program_type: Database["public"]["Enums"]["program_type"];
        description: string | null;
        website_url: string | null;
        application_url: string | null;
        logo_url: string | null;
        location: string | null;
        format: Database["public"]["Enums"]["program_format"];
        duration_text: string | null;
        cohort_name: string | null;
        stages: string[];
        industries: string[];
        business_models: string[];
        geographies: string[];
        funding_amount: number | null;
        funding_currency: string | null;
        equity_percent: number | null;
        funding_terms: string | null;
        benefits: Json;
        eligibility: Json;
        required_materials: Json;
        deadline: string | null;
        rolling: boolean;
        program_start_date: string | null;
        application_open: boolean | null;
        source_urls: Json;
        last_verified_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      accelerator_applications: Table<{
        id: string;
        workspace_id: string;
        company_id: string;
        accelerator_program_id: string | null;
        program_name_snapshot: string | null;
        form_url: string;
        status: Database["public"]["Enums"]["application_status"];
        status_error: string | null;
        deadline_snapshot: string | null;
        started_at: string | null;
        submitted_at: string | null;
        submission_confirmation: string | null;
        created_at: string;
        updated_at: string;
      }>;
      application_questions: Table<{
        id: string;
        workspace_id: string;
        application_id: string;
        question_label: string;
        field_type: string;
        field_selector_hint: string | null;
        required: boolean;
        max_words: number | null;
        max_characters: number | null;
        options: Json | null;
        constraints: Json;
        section_name: string | null;
        order_index: number;
        external_field_id: string | null;
        created_at: string;
        updated_at: string;
      }>;
      application_answers: Table<{
        id: string;
        workspace_id: string;
        application_id: string;
        question_id: string;
        answer_text: string | null;
        answer_file_path: string | null;
        status: "draft" | "edited" | "needs_input" | "approved";
        generated_from: Json;
        generation_metadata: Json;
        approved_by: string | null;
        approved_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      knowledge_base_entries: Table<{
        id: string;
        workspace_id: string;
        company_id: string;
        category: Database["public"]["Enums"]["knowledge_category"];
        content: string | null;
        source_type: Database["public"]["Enums"]["knowledge_source_type"];
        status: Database["public"]["Enums"]["knowledge_status"];
        confidence: number | null;
        version: number;
        approved_by: string | null;
        approved_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      knowledge_sources: Table<{
        id: string;
        workspace_id: string;
        knowledge_entry_id: string;
        source_type: Database["public"]["Enums"]["knowledge_source_type"];
        source_label: string | null;
        source_url: string | null;
        excerpt: string | null;
        metadata: Json;
        created_at: string;
      }>;
      browser_agent_runs: Table<{
        id: string;
        workspace_id: string;
        application_id: string;
        provider: "skyvern" | "mock";
        external_run_id: string | null;
        mode: "fill" | "submit";
        status: Database["public"]["Enums"]["browser_agent_status"];
        requires_human_input: boolean;
        human_input_reason: string | null;
        result_summary: Json | null;
        raw_response: Json | null;
        error_code: string | null;
        error_message: string | null;
        idempotency_key: string;
        started_at: string | null;
        completed_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      application_submit_authorizations: Table<{
        id: string;
        workspace_id: string;
        company_id: string;
        application_id: string;
        program_id: string;
        approved_fill_run_id: string;
        authorized_by: string;
        authorized_at: string;
        expires_at: string;
        revoked_at: string | null;
        dispatched_at: string | null;
      }>;
      application_dispatch_jobs: Table<{
        id: string;
        workspace_id: string;
        company_id: string;
        application_id: string;
        requested_by: string;
        kind: "fill" | "submit";
        request_intent: Json;
        idempotency_key: string;
        status: "queued" | "claimed" | "dispatching" | "dispatched" | "completed" | "failed" | "cancelled" | "unknown_dispatch";
        attempts: number;
        next_attempt_at: string;
        lease_until: string | null;
        correlation_id: string;
        browser_run_id: string | null;
        external_run_id: string | null;
        error_code: string | null;
        created_at: string;
        updated_at: string;
      }>;
      source_analysis_jobs: Table<{
        id: string;
        workspace_id: string;
        company_id: string;
        asset_id: string | null;
        requested_by: string;
        kind: "company" | "pitch_deck";
        analysis_run_id: string | null;
        status: "queued" | "running" | "completed" | "failed" | "cancelled";
        idempotency_key: string;
        attempts: number;
        next_attempt_at: string;
        lease_until: string | null;
        error_code: string | null;
        created_at: string;
        updated_at: string;
      }>;
      browser_agent_artifacts: Table<{
        id: string;
        workspace_id: string;
        run_id: string;
        type: "screenshot" | "final_preview" | "confirmation" | "log" | "other";
        storage_path: string | null;
        external_url: string | null;
        metadata: Json;
        created_at: string;
      }>;
      audit_logs: Table<{
        id: string;
        workspace_id: string;
        actor_user_id: string | null;
        application_id: string | null;
        action: string;
        from_status: string | null;
        to_status: string | null;
        metadata: Json;
        created_at: string;
      }>;
      notifications: Table<{
        id: string;
        workspace_id: string;
        user_id: string;
        type: string;
        title: string;
        message: string | null;
        metadata: Json;
        read_at: string | null;
        created_at: string;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      claim_application_dispatch_jobs: {
        Args: { max_jobs?: number };
        Returns: Database["public"]["Tables"]["application_dispatch_jobs"]["Row"][];
      };
      begin_application_dispatch: { Args: { target_job_id: string }; Returns: boolean };
      claim_source_analysis_jobs: {
        Args: { max_jobs?: number };
        Returns: Database["public"]["Tables"]["source_analysis_jobs"]["Row"][];
      };
      complete_founder_onboarding: {
        Args: { target_workspace_id: string };
        Returns: Json;
      };
      is_workspace_member: { Args: { target_workspace_id: string }; Returns: boolean };
      is_workspace_owner: { Args: { target_workspace_id: string }; Returns: boolean };
    };
    Enums: {
      company_stage: "idea" | "pre_seed" | "seed" | "series_a" | "later_stage" | "not_sure";
      founder_need:
        | "fundraising"
        | "investor_introductions"
        | "fundraising_preparation"
        | "pitch_deck_feedback"
        | "just_exploring";
      program_type: "accelerator" | "incubator" | "grant" | "venture_program" | "corporate_program" | "other";
      program_format: "remote" | "in_person" | "hybrid" | "unknown";
      application_status:
        | "draft"
        | "product_analyzing"
        | "product_ready"
        | "kb_approved"
        | "form_questions_extracting"
        | "form_questions_ready"
        | "answers_generating"
        | "answers_review_pending"
        | "answers_approved"
        | "agent_filling"
        | "agent_filled_pending_final_approval"
        | "submitting"
        | "submitted"
        | "submission_unverified"
        | "failed";
      knowledge_category:
        | "problem"
        | "solution"
        | "target_customer"
        | "market"
        | "traction"
        | "business_model"
        | "competition"
        | "team"
        | "ask";
      knowledge_source_type: "website" | "founder" | "manual" | "ai_inferred" | "pitch_deck";
      knowledge_status: "generated" | "needs_review" | "approved" | "founder_edited" | "missing";
      browser_agent_status: "queued" | "running" | "human_input_required" | "completed" | "failed" | "cancelled";
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
