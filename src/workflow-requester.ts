import type {FlowEvent} from './workflow';

// A direct work plan records its requester as the initial plan registration.
// In linked inspection workflows, retain the original requester's identity.
export function workflowRequester(history:FlowEvent[]):FlowEvent|undefined {
  const ordered=[...history].sort((a,b)=>Date.parse(a.occurred_at)-Date.parse(b.occurred_at)||a.id-b.id);
  return ordered.find(event=>event.stage==='request')||ordered.find(event=>event.stage==='plan');
}
