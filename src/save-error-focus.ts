type Plan = Record<string, unknown>;

/** Resolve server and client validation messages without mistaking connection errors for input errors. */
export function saveErrorFields(message: string, plan: Plan = {}): string[] {
 const fields = new Set<string>();
 const add = (...keys: string[]) => keys.forEach(key => fields.add(key));
 if (/근무일 계획일·시간대·예상 소요시간·예상비용/.test(message)) {
  if (!plan.plannedDate) add('plannedDate');
  if (!plan.window || plan.window === 'unplanned') add('window');
  if (plan.estimatedMinutes == null) add('estimatedMinutes');
  if (plan.estimatedCost == null) add('estimatedCost');
 }
 const rules: [RegExp, string[]][] = [
  [/작업 예정일|달력 날짜|근무일 작업 예정일|계획일 또는/, ['plannedDate']],
  [/작업 시간대를|일요일 일반 작업|일요일 특별 작업은 일요일|일요일 날짜/, ['window']],
  [/보전 구분|긴급사후보전으로/, ['category']],
  [/예상 소요시간|90분 이내|시간은 1분|예상 전체/, ['estimatedMinutes']],
  [/예상비용|예상비용을|예상 보전비/, ['estimatedCost']],
  [/계획 시작 날짜/, ['plannedStartAt']],
  [/계획 종료는|계획 종료 날짜/, ['plannedEndAt']],
  [/실제.*시작.*입력|실제 시작 날짜/, ['actualStartAt']],
  [/실제.*종료.*입력|실제 종료는|실제 종료 날짜/, ['actualEndAt']],
  [/실제 시간과 실제 비용|실제 시간·비용/, ['actualMinutes', 'actualCost']],
  [/실제 비용|실제 보전비/, ['actualCost']],
  [/일요일 작업 사유|일요일 작업 사유와/, ['emergencyReason']],
  [/안전 확인|안전절차 확인/, ['safetyChecked']],
  [/기능·품질 확인과 생산 인계|복구 확인/, ['functionChecked', 'qualityChecked', 'productionHandedOver']],
  [/관리자 승인|작업계획 승인|반려된 작업/, ['approval']],
  [/점검 양식을 선택|체크리스트.*미점검/, ['checklist']],
  [/사진은 총/, ['photos']],
 ];
 // The aggregate server message names every prerequisite; select only those actually missing.
 const detail = message.replace(/근무일 계획일·시간대·예상 소요시간·예상비용/g, '');
 for (const [pattern, keys] of rules) if (pattern.test(detail)) add(...keys);
 for (const [prefix, key] of [['계획 시작','plannedStartAt'],['계획 종료','plannedEndAt'],['실제 시작','actualStartAt'],['실제 종료','actualEndAt']]) {
  if (message.includes(`${prefix} 날짜와 시각`)) add(key);
 }
 return [...fields];
}

export function clearSaveErrorFocus(form: HTMLFormElement) {
 form.querySelectorAll('[data-save-invalid]').forEach(element => {
  element.removeAttribute('aria-invalid');
  element.removeAttribute('data-save-invalid');
  element.removeAttribute('aria-describedby');
 });
 form.querySelectorAll('[data-save-error]').forEach(element => element.removeAttribute('data-save-error'));
}

export function focusSaveError(form: HTMLFormElement, message: string, plan: Plan = {}) {
 requestAnimationFrame(() => {
  if (!form.isConnected) return;
  clearSaveErrorFocus(form);
  const fields = saveErrorFields(message, plan);
  const controls = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-save-field]')];
  const candidates = controls.filter(control => fields.includes(control.dataset.saveField || '') && !control.disabled && !('readOnly' in control && control.readOnly) && control.getClientRects().length > 0);
  const target = candidates.find(control => control.type === 'checkbox' ? !(control as HTMLInputElement).checked : !control.value || control.value === 'unplanned' || control.value === '미점검') || candidates[0];
  const fallback = form.querySelector<HTMLElement>('#record-save-error');
  if (target) {
   target.setAttribute('aria-invalid', 'true');
   target.setAttribute('data-save-invalid', 'true');
   target.setAttribute('aria-describedby', 'record-save-error');
   target.closest('label')?.setAttribute('data-save-error', message);
  }
  const destination = target || fallback;
  destination?.scrollIntoView({block: 'center', behavior: 'instant'});
  destination?.focus({preventScroll: true});
 });
}
