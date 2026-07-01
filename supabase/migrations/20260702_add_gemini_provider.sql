-- Multi-provider AI support: users can now bring a Gemini key alongside (or instead of)
-- an Anthropic key. preferred_ai_provider selects which one drives the non-agentic
-- calls (CV parsing, scoring, cover letters, etc). Agentic search still requires
-- Anthropic because it uses Claude's MCP tool-use.
ALTER TABLE "user_api_keys" ADD COLUMN IF NOT EXISTS "gemini_key" text;
ALTER TABLE "user_api_keys" ADD COLUMN IF NOT EXISTS "preferred_ai_provider" text NOT NULL DEFAULT 'anthropic';
ALTER TABLE "user_api_keys" ADD CONSTRAINT "user_api_keys_preferred_ai_provider_check"
  CHECK ("preferred_ai_provider" IN ('anthropic', 'gemini'));
