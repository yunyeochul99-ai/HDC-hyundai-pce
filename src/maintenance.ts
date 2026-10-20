import { readableError, supabase } from './backend';

export type WorkPlan = {
  category: '예방보전' | '상태기반' | '고장수리' | '개선보전' | '유휴설비관리' | '긴급사후보전';
  plannedDate: string;
  plannedStartAt: string;plannedEndAt: string;actualStartAt: string;actualEndAt: string;
  window: 'morning' | 'weekday' | 'unplanned' | 'sundayEmergency';
  /** Total preparation, repair, functional/quality checks and production handover. */
  estimatedMinutes: number | null;
  estimatedCost: number | null;
  actualMinutes: number | null;
  actualCost: number | null;
  qualityImpact: boolean;
  productionImpact: boolean;
  idleEquipment: boolean;
  safetyChecked: boolean;
  functionChecked: boolean;
  qualityChecked: boolean;
  productionHandedOver: boolean;
  approval: '미검토' | '검토요청' | '승인' | '반려';
  approvalNote: string;
  emergencyReason: string;
};

export type MaintenancePolicy = {
  highCostThreshold: number | null;
  manufacturingCost: number | null;
  costPeriod: string;
  policyVersion: number;
};

export const defaultPlan: WorkPlan = {
  category: '고장수리', plannedDate: '',plannedStartAt:'',plannedEndAt:'',actualStartAt:'',actualEndAt:'', window: 'unplanned',
  estimatedMinutes: null, estimatedCost: null, actualMinutes: null, actualCost: null,
  qualityImpact: false, productionImpact: false, idleEquipment: false,
  safetyChecked: false, functionChecked: false, qualityChecked: false,
  productionHandedOver: false, approval: '미검토', approvalNote: '', emergencyReason: '',
};

export const defaultPolicy: MaintenancePolicy = {
  highCostThreshold: 1000000, manufacturingCost: null,
  costPeriod: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date()),
  policyVersion: 0,
};

const categories = ['예방보전', '상태기반', '고장수리', '개선보전', '유휴설비관리', '긴급사후보전'];
const approvals = ['미검토', '검토요청', '승인', '반려'];
const windows = ['morning', 'weekday', 'unplanned', 'sundayEmergency'];
const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** Normalize missing legacy fields for display. The database independently validates writes. */
export function normalizePlan(input: unknown): WorkPlan {
  const p = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  return {
    category: (categories.includes(p.category as string) ? p.category : defaultPlan.category) as WorkPlan['category'],
    plannedDate: typeof p.plannedDate === 'string' ? p.plannedDate : '',
    plannedStartAt:typeof p.plannedStartAt==='string'?p.plannedStartAt:'',plannedEndAt:typeof p.plannedEndAt==='string'?p.plannedEndAt:'',actualStartAt:typeof p.actualStartAt==='string'?p.actualStartAt:'',actualEndAt:typeof p.actualEndAt==='string'?p.actualEndAt:'',
    window: (windows.includes(p.window as string) ? p.window : defaultPlan.window) as WorkPlan['window'],
    estimatedMinutes: numberOrNull(p.estimatedMinutes), estimatedCost: numberOrNull(p.estimatedCost),
    actualMinutes: numberOrNull(p.actualMinutes), actualCost: numberOrNull(p.actualCost),
    qualityImpact: p.qualityImpact === true, productionImpact: p.productionImpact === true,
    idleEquipment: p.idleEquipment === true, safetyChecked: p.safetyChecked === true,
    functionChecked: p.functionChecked === true, qualityChecked: p.qualityChecked === true,
    productionHandedOver: p.productionHandedOver === true,
    approval: (approvals.includes(p.approval as string) ? p.approval : defaultPlan.approval) as WorkPlan['approval'],
    approvalNote: typeof p.approvalNote === 'string' ? p.approvalNote : '',
    emergencyReason: typeof p.emergencyReason === 'string' ? p.emergencyReason : '',
  };
}

export function validWorkTimestamp(value:string){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return false;const d=new Date(value+'+09:00');return Number.isFinite(d.getTime())&&new Date(d.getTime()+9*3600000).toISOString().slice(0,16)===value;}
export function workIntervalMinutes(start:string,end:string){return validWorkTimestamp(start)&&validWorkTimestamp(end)?(Date.parse(end+'+09:00')-Date.parse(start+'+09:00'))/60000:null;}

export type PlanAssessment = {
  errors: string[]; warnings: string[]; longWork: boolean; highCost: boolean;
  budgetReview: boolean; special: boolean; requiresApproval: boolean;
  morningEligible: boolean; weekend: boolean; sundayEmergency: boolean;
};

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function assessPlan(plan: WorkPlan, policy: MaintenancePolicy, status = '접수'): PlanAssessment {
  const errors: string[] = [];
  const warnings: string[] = [];
  const hasDate = validDate(plan.plannedDate);
  const day = hasDate ? new Date(`${plan.plannedDate}T12:00:00Z`).getUTCDay() : -1;
  // Company workweek is Monday through Saturday; only Sunday is excluded.
  const weekend = day === 0;
  const longWork = plan.estimatedMinutes !== null && plan.estimatedMinutes > 90;
  const highCost = policy.highCostThreshold !== null && Math.max(plan.estimatedCost ?? -1,plan.actualCost ?? -1) >= policy.highCostThreshold;
  const budgetReview = policy.highCostThreshold === null;
  const sundayEmergency = weekend && plan.category === '긴급사후보전' && plan.window === 'sundayEmergency';
  const special = longWork || highCost || sundayEmergency;
  const active = ['배정', '진행', '완료'].includes(status);
  const requiresApproval = special;
  for(const [label,value] of [['계획 시작',plan.plannedStartAt],['계획 종료',plan.plannedEndAt],['실제 시작',plan.actualStartAt],['실제 종료',plan.actualEndAt]])if(value&&!validWorkTimestamp(value))errors.push(`${label} 날짜와 시각을 확인하세요.`);
  if(plan.window==='weekday'){
    if(!hasDate||!plan.plannedStartAt||!plan.plannedEndAt)errors.push('별도 근무일 정지는 정비 날짜·계획 시작·종료 시각을 모두 입력하세요.');
    if(plan.plannedStartAt&&plan.plannedStartAt.slice(0,10)!==plan.plannedDate)errors.push('작업 예정일과 계획 시작 날짜를 같게 입력하세요.');
    if(workIntervalMinutes(plan.plannedStartAt,plan.plannedEndAt)!==null&&workIntervalMinutes(plan.plannedStartAt,plan.plannedEndAt)!<=0)errors.push('계획 종료는 시작 이후여야 합니다.');
    if(['진행','완료'].includes(status)&&!plan.actualStartAt)errors.push('작업 진행 전에 실제 정비 시작 시각을 입력하세요.');
    if(status==='완료'&&!plan.actualEndAt)errors.push('완료 전에 실제 정비 종료 시각을 입력하세요.');
  }
  if(plan.actualEndAt&&!plan.actualStartAt)errors.push('실제 종료를 입력하려면 실제 시작 시각을 입력하세요.');
  if(workIntervalMinutes(plan.actualStartAt,plan.actualEndAt)!==null&&workIntervalMinutes(plan.actualStartAt,plan.actualEndAt)!<=0)errors.push('실제 종료는 시작 이후여야 합니다.');
  if (plan.plannedDate && !hasDate) errors.push('실제 달력 날짜를 입력하세요.');
  if (weekend && !sundayEmergency) errors.push('일요일 일반 작업은 제외합니다. 불가피한 작업은 긴급사후보전과 일요일 특별 작업 시간대를 선택하세요.');
  if (plan.window === 'sundayEmergency' && hasDate && !weekend) errors.push('일요일 특별 작업은 일요일 날짜를 선택하세요. 월~토 작업은 근무일 시간대를 사용하세요.');
  if (plan.window === 'sundayEmergency' && plan.category !== '긴급사후보전') errors.push('일요일 특별 작업의 보전 구분은 긴급사후보전으로 선택하세요.');
  if (plan.window === 'sundayEmergency' && !plan.emergencyReason.trim()) errors.push('불가피한 일요일 작업 사유와 긴급 조치 범위를 입력하세요.');
  if (active && !hasDate) errors.push('배정·진행·완료 전에 근무일 작업 예정일을 입력하세요.');
  if (active && plan.window === 'unplanned') errors.push('배정·진행·완료 전에 작업 시간대를 선택하세요.');
  if (active && plan.estimatedMinutes === null) errors.push('준비부터 생산 인계까지 예상 소요시간을 입력하세요.');
  if (active && plan.estimatedCost === null) errors.push('배정·실행 전에 예상비용을 입력하세요. 비용이 없으면 0원을 입력하세요.');
  if (active && plan.estimatedMinutes !== null && plan.estimatedMinutes <= 0) errors.push('예상 소요시간은 1분 이상이어야 합니다.');
  if (plan.window === 'morning' && longWork) errors.push('08:00~09:30 작업은 준비·점검·인계를 포함하여 90분 이내여야 합니다.');
  if (['진행', '완료'].includes(status) && !plan.safetyChecked) errors.push('작업 전에 안전 확인을 완료하세요.');
  if (status === '완료' && (!plan.functionChecked || !plan.qualityChecked || !plan.productionHandedOver)) errors.push('완료 전 기능·품질 확인과 생산 인계를 모두 확인하세요.');
  if (status === '완료' && (plan.actualMinutes === null || plan.actualCost === null)) errors.push('완료 전에 실제 시간과 실제 비용을 입력하세요. 비용이 없으면 0원을 입력하세요.');
  if (active && requiresApproval && plan.approval !== '승인') errors.push('장시간·고액·일요일 긴급 작업은 관리자 승인 후 배정·실행하세요.');
  if (active && plan.approval === '반려') errors.push('반려된 작업은 계획을 보완하고 다시 검토받으세요.');
  if (sundayEmergency) warnings.push('일요일 긴급사후보전입니다. 관리자 승인과 현장 안전절차를 확인한 뒤 작업하세요.');
  if (longWork) warnings.push('90분을 넘는 작업입니다. 근무일 정지계획과 작업 분할·외주 필요성을 검토하세요.');
  if (highCost) warnings.push('고액 특별관리 대상입니다. 수리·교체 대안과 예산을 검토하세요.');
  if (budgetReview) warnings.push('고액 기준이 미설정되어 예산 검토가 필요합니다. 관리자가 기준을 확정하세요.');
  if (plan.estimatedCost === null) warnings.push('예상비용이 미입력되어 비용 검토가 필요합니다.');
  if (plan.qualityImpact) warnings.push('제품 품질에 영향이 있습니다. 품질 요구사항과 재가동 판정 기준을 확인하세요.');
  if (plan.productionImpact) warnings.push('생산에 영향이 있습니다. 생산부서와 근무일 정지·복구 시점을 협의하세요.');
  if (plan.idleEquipment) warnings.push('유휴설비는 보존·안전 위주로 관리하고 불필요한 정비비를 줄이세요.');
  return { errors, warnings, longWork, highCost, budgetReview, special, requiresApproval, morningEligible: hasDate && plan.estimatedMinutes !== null && plan.estimatedMinutes > 0 && plan.estimatedMinutes <= 90 && !weekend, weekend, sundayEmergency };
}

export async function getPolicy(): Promise<MaintenancePolicy> {
  const { data, error } = await supabase.from('hdc_v2_maintenance_policy').select('payload').eq('key', 'factory').maybeSingle();
  if (error) throw new Error(readableError(error));
  return data?.payload ? { ...defaultPolicy, ...data.payload } as MaintenancePolicy : { ...defaultPolicy };
}

export async function savePolicy(policy: MaintenancePolicy): Promise<MaintenancePolicy> {
  const { data, error } = await supabase.rpc('hdc_v2_save_maintenance_policy', { p_policy: policy });
  if (error) throw new Error(readableError(error));
  return data as MaintenancePolicy;
}

export async function loadPlans(): Promise<Record<string, WorkPlan>> {
  const plans: Record<string, WorkPlan> = {};
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('hdc_v2_work_plans').select('record_id,planning').order('record_id').range(offset, offset + 499);
    if (error) throw new Error(readableError(error));
    for (const row of data || []) plans[row.record_id] = normalizePlan(row.planning);
    if (!data || data.length < 500) break;
  }
  return plans;
}

/** Return the raw Supabase result so the caller can preserve PT409 conflict details. */
export async function savePlannedRecord<T extends Record<string, unknown>>(record: T, planning?: WorkPlan | null) {
  const { planning: embedded, ...body } = record;
  return supabase.rpc('hdc_v2_save_planned_record', { p_record: body, p_planning: planning ?? embedded ?? null });
}



