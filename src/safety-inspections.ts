import {supabase,readableError} from './backend';

export type SafetyCadence='일별'|'주별'|'월별';
export type SafetyResult='미점검'|'양호'|'불량'|'해당없음';
export type SafetyItem={id:string;name:string;standard:string;result:SafetyResult;note:string;custom?:boolean};
export type SafetyInspection={id:string;cadence:SafetyCadence;inspection_date:string;area:string;inspector:string;shift:string;status:'작성중'|'완료';follow_up:string;items:SafetyItem[];version:number;created_by:string;updated_by:string;created_at:string;updated_at:string};

const standards='사내 안전기준·제조사 지침을 확인하고, 위험한 시험·분해는 자격자 절차에 따릅니다.';
const templates:Record<SafetyCadence,{name:string;standard:string}[]>={
 일별:[
  {name:'통로·출입구·비상구 장애물 및 미끄럼 위험',standard:'통행·대피 공간을 확보하고 누유·낙하물·바닥 손상을 확인합니다.'},
  {name:'작업장 정리정돈·분진·폐기물',standard:'작업장과 설비 주변의 낙하·걸림·화재 위험을 확인합니다.'},
  {name:'기계 방호덮개·인터록·비상정지 외관',standard:'작동 중 접근 위험과 방호장치의 외관 상태를 확인합니다. 임의 우회·시험은 금지합니다.'},
  {name:'전선·플러그·호스 손상 및 걸림',standard:'노출·눌림·누설·걸림 위험을 육안으로 확인하고 손상품은 사용하지 않습니다.'},
  {name:'보호구 착용·작업구역 출입 통제',standard:'작업 위험에 맞는 보호구와 접근 통제 상태를 확인합니다.'},
  {name:'중량물·자재 적재 및 전도 위험',standard:'적재 상태와 고정 여부, 이동 동선을 확인합니다.'},
  {name:'지게차·차량·보행자 동선 분리',standard:'교차 구간의 시야·표지·보행자 안전을 확인합니다.'},
  {name:'화재·누출·이상 소음 등 당일 위험요인',standard:standards}
 ],
 주별:[
  {name:'설비 방호장치·안전난간·고정 상태',standard:'주요 설비와 작업발판의 외관·고정·누락을 확인합니다.'},
  {name:'크레인·호이스트·훅·와이어·슬링 외관',standard:'사용 전 육안 확인과 식별표시·손상 여부를 봅니다. 법정검사·전문검사를 대체하지 않습니다.'},
  {name:'지게차·운반장비 경광등·경적·후진경보 외관',standard:'운전자 점검표와 사내 운행기준에 따라 확인합니다.'},
  {name:'전기실·분전반 접근 공간·표시·주변 정리',standard:'전기설비 작업은 자격자만 수행하고 충전부를 개방하지 않습니다.'},
  {name:'가스·스팀·유압 호스와 배관 누설·마모',standard:'누출·부식·보온재 손상과 주변 위험을 확인합니다.'},
  {name:'사다리·작업대·고소 작업용 접근설비',standard:'파손·미끄럼·잠금·사용 구역을 확인합니다.'},
  {name:'소화기·소화전·비상통로 접근성',standard:'위치·표시·접근 장애 여부를 확인합니다. 작동시험은 승인된 담당자 절차에 따릅니다.'},
  {name:'화학물질 보관·용기 표시·누출 대응물품',standard:'용기 상태·라벨·보관구역과 비치된 안전자료를 확인합니다.'},
  {name:'이전 점검 불량·임시조치 후속 확인',standard:'미조치 위험은 담당자와 기한을 정해 별도 후속 요청에 연결합니다.'}
 ],
 월별:[
  {name:'월간 위험요인·반복 불량·아차사고 검토',standard:'반복 위치·작업·원인을 확인하고 재발방지 조치를 지정합니다.'},
  {name:'비상대피로·유도표지·비상조명 상태',standard:'표시·접근성 및 승인된 점검기록을 확인합니다.'},
  {name:'소방·비상대응 설비의 관리기록',standard:'정해진 담당자와 사내 기준에 따른 점검기록을 확인합니다.'},
  {name:'잠금·표지(LOTO) 및 정비 작업 안전 준비',standard:'에너지 차단·작업허가·복구 확인 절차의 적용 여부를 확인합니다.'},
  {name:'협력사 작업구역·작업허가·위험정보 전달',standard:'작업 전 위험정보 공유와 구역 통제 기록을 확인합니다.'},
  {name:'안전교육·신규 작업자 안내·보호구 관리',standard:'교육 및 지급·교체 기록의 누락 여부를 확인합니다.'},
  {name:'고위험 작업의 위험성 검토·작업 전 회의',standard:'해당 작업이 있을 때 승인된 절차와 기록을 확인합니다.'},
  {name:'지난달 조치사항 담당자·기한·완료 근거',standard:'완료 근거를 확인하고 미완료 항목은 새 기한과 책임자를 정합니다.'},
  {name:'안전표지·차단시설·보행자/차량 분리',standard:'표지 가독성·고정 상태와 현장 동선 변경을 확인합니다.'},
  {name:'점검 누락·기록 보존·개선 과제 검토',standard:'점검 범위의 누락과 미해결 위험을 검토하고 다음 조치를 기록합니다.'}
 ]
};

const id=()=>crypto.randomUUID();
export function newSafetyInspection(cadence:SafetyCadence,inspector=''):SafetyInspection{return {id:id(),cadence,inspection_date:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'}),area:'',inspector,shift:'',status:'작성중',follow_up:'',items:templates[cadence].map(x=>({id:id(),...x,result:'미점검',note:''})),version:0,created_by:'',updated_by:'',created_at:'',updated_at:''};}
export async function loadSafetyInspections():Promise<SafetyInspection[]>{const {data,error}=await supabase.from('hdc_v2_safety_inspections').select('id,cadence,inspection_date,area,inspector,shift,status,follow_up,items,version,created_by,updated_by,created_at,updated_at').order('inspection_date',{ascending:false}).order('updated_at',{ascending:false});if(error)throw Error(readableError(error));return (data||[]) as SafetyInspection[];}
export async function saveSafetyInspection(record:SafetyInspection,expectedVersion:number):Promise<SafetyInspection>{const {data,error}=await supabase.rpc('hdc_v2_safety_inspection_save',{p_record:record,p_expected_version:expectedVersion});if(error)throw Error(readableError(error));return data as SafetyInspection;}
