alter policy assignment_events_owner on public.hdc_v2_assignment_events using ((select hdc_v2_private.is_approved()) and actor_id=(select auth.uid()));

