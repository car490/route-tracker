-- Spoken text: add a space after a comma that has none (John, 2026-09-24).
-- Many stop names are stored as "Boston,College" (248 of 404 production clips),
-- which a voice reads with no pause. Speech only: display_name() (the sign) is
-- untouched, and clip keys don't change because the slug ignores punctuation
-- and spaces. Only a comma followed by a letter is spaced, so "1,000" stays.
-- stops.spoken_name is still used verbatim. Idempotent; safe to re-run.

create or replace function public.announcement_speech_name(p_name text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           regexp_replace(p_name, '\s*\([^)]*\)', '', 'g'),
           ',([A-Za-z])', ', \1', 'g')
$$;

-- Re-queue only the clips whose wording changes: stops whose spoken name has
-- a comma directly before a letter, and route-start clips for the timetables
-- that end at one of them. The drain renders them in the environment's voice.
do $$
declare
  v_stops uuid[];
  v_tts   uuid[];
begin
  select array_agg(s.id) into v_stops
  from public.stops s
  where s.spoken_name is null
    and regexp_replace(public.display_name(s.*), '\s*\([^)]*\)', '', 'g') ~ ',[A-Za-z]';

  if v_stops is not null then
    perform public.enqueue_stop_clips(v_stops, false);

    select array_agg(t.id) into v_tts
    from public.timetables t
    where (select ts.stop_id from public.timetable_stops ts
           where ts.timetable_id = t.id order by ts.sequence desc limit 1) = any(v_stops);
    if v_tts is not null then
      perform public.enqueue_service_clips_for_timetables(v_tts);
    end if;
  end if;
end $$;
