-- Exact start and end times: stopping a timer at an earlier time, and changing a running
-- breastfeed's start.

-- Stop any running timer. For nursing, stores left/right seconds. Safe to replay.
-- Stopped at an earlier time ("she finished 10 minutes ago"), side time after the end no longer
-- counts: every side is cut off at the end, so left and right never add up to more than the feed.
create or replace function public.timer_stop(p_event_id uuid, p_at timestamptz)
returns void language plpgsql set search_path = '' as $$
declare
  v_event public.events;
  v_left int;
  v_right int;
  v_end timestamptz;
begin
  select * into v_event from public.events e
   where e.id = p_event_id and e.deleted_at is null for update;
  if not found or v_event.ended_at is not null then
    return;
  end if;
  v_end := greatest(p_at, v_event.started_at);
  update public.timer_segments set ended_at = greatest(v_end, started_at)
   where event_id = p_event_id and (ended_at is null or ended_at > v_end);
  if v_event.type = 'nursing' then
    select coalesce(sum(extract(epoch from (s.ended_at - s.started_at))) filter (where s.side = 'left'), 0)::int,
           coalesce(sum(extract(epoch from (s.ended_at - s.started_at))) filter (where s.side = 'right'), 0)::int
      into v_left, v_right
      from public.timer_segments s where s.event_id = p_event_id;
    update public.events
       set ended_at = v_end, timer_state = null,
           data = data || jsonb_build_object('left_s', v_left, 'right_s', v_right)
     where id = p_event_id;
  else
    update public.events set ended_at = v_end, timer_state = null where id = p_event_id;
  end if;
end $$;

-- A running breastfeed's start was changed: its sides follow, so the first side began then and no
-- side time counts before it. Works from the start saved on the entry, so it is safe to replay.
create or replace function public.nursing_align_start(p_event_id uuid)
returns void language plpgsql set search_path = '' as $$
declare
  v_event public.events;
  v_first uuid;
begin
  select * into v_event from public.events e
   where e.id = p_event_id and e.deleted_at is null for update;
  if not found or v_event.type <> 'nursing' or v_event.timer_state is null then
    return;
  end if;
  update public.timer_segments
     set started_at = v_event.started_at,
         ended_at = case when ended_at is null then null else greatest(ended_at, v_event.started_at) end
   where event_id = p_event_id and started_at < v_event.started_at;
  select s.id into v_first from public.timer_segments s
   where s.event_id = p_event_id order by s.started_at, s.created_at limit 1;
  update public.timer_segments set started_at = v_event.started_at
   where id = v_first and started_at > v_event.started_at;
end $$;

revoke execute on function public.nursing_align_start(uuid) from public, anon;
grant execute on function public.nursing_align_start(uuid) to authenticated;
