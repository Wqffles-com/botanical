-- Idempotent guards applied by `bun run migrate` after Drizzle migrations.
-- Postgres 15+. Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'updated_at'
      AND c.table_name IN (
        'tenants',
        'users',
        'agents',
        'model_profiles',
        'chats',
        'messages',
        'agent_messages',
        'settings',
        'secret_refs'
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', r.table_name || '_set_updated_at', r.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      r.table_name || '_set_updated_at',
      r.table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION chats_reject_agent_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.agent_id IS DISTINCT FROM OLD.agent_id THEN
    RAISE EXCEPTION 'chats.agent_id is immutable (one agent per chat)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chats_agent_id_immutable ON chats;
CREATE TRIGGER chats_agent_id_immutable
  BEFORE UPDATE OF agent_id ON chats
  FOR EACH ROW
  EXECUTE FUNCTION chats_reject_agent_change();

CREATE OR REPLACE FUNCTION chats_same_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  agent_owner uuid;
  profile_owner uuid;
BEGIN
  SELECT user_id INTO agent_owner FROM agents WHERE id = NEW.agent_id;
  SELECT user_id INTO profile_owner FROM model_profiles WHERE id = NEW.profile_id;
  IF agent_owner IS DISTINCT FROM NEW.user_id OR profile_owner IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'chat, agent, and model profile must belong to the same user';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chats_same_owner ON chats;
CREATE TRIGGER chats_same_owner
  BEFORE INSERT OR UPDATE ON chats
  FOR EACH ROW
  EXECUTE FUNCTION chats_same_owner();

CREATE OR REPLACE FUNCTION agent_messages_same_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  from_owner uuid;
  to_owner uuid;
BEGIN
  SELECT user_id INTO from_owner FROM agents WHERE id = NEW.from_agent;
  SELECT user_id INTO to_owner FROM agents WHERE id = NEW.to_agent;
  IF from_owner IS DISTINCT FROM to_owner THEN
    RAISE EXCEPTION 'agent-to-agent messages must stay within one user';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_messages_same_owner ON agent_messages;
CREATE TRIGGER agent_messages_same_owner
  BEFORE INSERT OR UPDATE ON agent_messages
  FOR EACH ROW
  EXECUTE FUNCTION agent_messages_same_owner();

CREATE OR REPLACE FUNCTION tool_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'tool_audit is append-only';
END;
$$;

DROP TRIGGER IF EXISTS tool_audit_no_update ON tool_audit;
CREATE TRIGGER tool_audit_no_update
  BEFORE UPDATE ON tool_audit
  FOR EACH ROW
  EXECUTE FUNCTION tool_audit_append_only();

DROP TRIGGER IF EXISTS tool_audit_no_delete ON tool_audit;
CREATE TRIGGER tool_audit_no_delete
  BEFORE DELETE ON tool_audit
  FOR EACH ROW
  EXECUTE FUNCTION tool_audit_append_only();

CREATE OR REPLACE FUNCTION settings_validate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  as_text text;
BEGIN
  IF NEW.key = 'deployment.mode' THEN
    IF jsonb_typeof(NEW.value) <> 'string' THEN
      RAISE EXCEPTION 'settings.deployment.mode must be a JSON string';
    END IF;
    as_text := NEW.value #>> '{}';
    IF as_text NOT IN ('self_host', 'saas') THEN
      RAISE EXCEPTION 'settings.deployment.mode must be self_host or saas';
    END IF;
  ELSIF NEW.key IN ('auth.passcode_env', 'auth.passcode_alias_env', 'auth.passcode_hash_env') THEN
    IF jsonb_typeof(NEW.value) <> 'string' THEN
      RAISE EXCEPTION 'settings.% must be a JSON string', NEW.key;
    END IF;
    as_text := NEW.value #>> '{}';
    IF as_text !~ '^[A-Z][A-Z0-9_]*$' THEN
      RAISE EXCEPTION 'settings.% must name an env var', NEW.key;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS settings_validate ON settings;
CREATE TRIGGER settings_validate
  BEFORE INSERT OR UPDATE ON settings
  FOR EACH ROW
  EXECUTE FUNCTION settings_validate();

COMMIT;
