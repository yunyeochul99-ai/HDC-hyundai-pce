import {Photo} from './AuthGate';
import {photoDetail,photoStageLabels,type PhotoDetails,type PhotoStage} from './photo-details';
import './record-photos.css';
export default function PhotoComparison({photoIds,photoDetails}:{photoIds:string[];photoDetails?:PhotoDetails}){
 if(!photoIds.length)return null;
 const group=(stage:PhotoStage)=><section className={`photo-comparison-group photo-stage-${stage}`}><h4>{photoStageLabels[stage]} 사진 <span>{photoIds.filter(id=>photoDetail(photoDetails,id).stage===stage).length}장</span></h4>{photoIds.filter(id=>photoDetail(photoDetails,id).stage===stage).map((id,index)=>{const detail=photoDetail(photoDetails,id);return <figure key={id}><Photo id={id} alt={`${photoStageLabels[stage]} 사진 ${index+1}${detail.part?' · '+detail.part:''}`}/><figcaption><b>{detail.part||'부위 미기재'}</b>{detail.caption&&<p>{detail.caption}</p>}</figcaption></figure>;})}{!photoIds.some(id=>photoDetail(photoDetails,id).stage===stage)&&<p className="record-photos-empty">등록된 {photoStageLabels[stage]} 사진이 없습니다.</p>}</section>;
 return <section className="photo-comparison"><h3>보수 전·후 사진 비교</h3><p className="record-photos-help">부위와 설명을 함께 확인하세요. 기존 사진은 미분류로 보존되며 기록 수정에서 분류할 수 있습니다.</p><div className="photo-comparison-columns">{group('before')}{group('after')}</div>{photoIds.some(id=>photoDetail(photoDetails,id).stage==='unclassified')&&group('unclassified')}</section>;
}
