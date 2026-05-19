-- migration_generate_duty_token_rpc.sql
-- Moves JWT signing from the Edge Function into a database RPC using pgcrypto.
-- This eliminates the dependency on the Edge Function being deployed/reachable.
--
-- The produced JWT is identical in structure to the Edge Function output and is
-- compatible with is_jwt_journey_allowed() and all existing anon RLS policies.

create extension if not exists pgcrypto;

create or replace function public.generate_duty_token(
  p_journey_ids  uuid[],
  p_driver_name  text,
  p_driver_id    uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  -- HS256 JWT header is a fixed constant
  v_header      text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
  v_payload     jsonb;
  v_payload_b64 text;
  v_input       text;
  v_sig         text;
  v_now         bigint;
  v_secret      text;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'Unauthorized';
  end if;

  v_now    := extract(epoch from clock_timestamp())::bigint;
  v_secret := current_setting('app.settings.jwt_secret', true);

  if v_secret is null or v_secret = '' then
    raise exception 'JWT secret unavailable';
  end if;

  v_payload := jsonb_build_object(
    'iss',         'supabase',
    'role',        'anon',
    'driver_name', coalesce(p_driver_name, 'Driver'),
    'driver_id',   p_driver_id,
    'journey_ids', coalesce(
                     (select jsonb_agg(elem::text) from unnest(p_journey_ids) as elem),
                     '[]'::jsonb
                   ),
    'iat',         v_now,
    'exp',         v_now + 86400
  );

  -- base64url-encode payload (remove newlines pgcrypto adds, swap +/ → -_)
  v_payload_b64 := replace(replace(replace(
    replace(encode(convert_to(v_payload::text, 'UTF8'), 'base64'), chr(10), ''),
    '+', '-'), '/', '_'), '=', '');

  v_input := v_header || '.' || v_payload_b64;

  -- HMAC-SHA256, then base64url-encode the signature
  v_sig := replace(replace(replace(
    replace(encode(hmac(convert_to(v_input, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256'), 'base64'), chr(10), ''),
    '+', '-'), '/', '_'), '=', '');

  return v_input || '.' || v_sig;
end;
$$;

grant execute on function public.generate_duty_token(uuid[], text, uuid) to authenticated;
