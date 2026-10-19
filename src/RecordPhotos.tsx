import { useEffect, useRef, useState } from 'react';
import { Photo } from './AuthGate';
import { preparePhoto, photoSize } from './photo-compression';
import './record-photos.css';
import {photoStages,photoStageLabels,photoDetail,photoFileKey,emptyPhotoDetail,type PhotoDetails,type PhotoDetail,type PhotoStage} from './photo-details';

type Props = {
  photoIds: string[];
  photoDetails: PhotoDetails;
  fileDetails: PhotoDetails;
  onPhotoDetailsChange: (details: PhotoDetails) => void;
  onFileDetailsChange: (details: PhotoDetails) => void;
  files: File[];
  disabled: boolean;
  onPhotosChange: (ids: string[]) => void;
  onFilesChange: (files: File[]) => void;
  onError: (message: string) => void;
  onPreparingChange: (preparing: boolean) => void;
};

function SelectedPhoto({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <img src={url} alt={`추가할 사진: ${file.name}`} /> : null;
}

function DetailFields({label,value,disabled,onChange}:{label:string;value:PhotoDetail;disabled:boolean;onChange:(detail:PhotoDetail)=>void}){return <div className="record-photo-fields"><label>사진 구분<select aria-label={`${label} 사진 구분`} disabled={disabled} value={value.stage} onChange={e=>onChange({...value,stage:e.target.value as PhotoStage})}>{photoStages.map(stage=><option key={stage} value={stage}>{photoStageLabels[stage]}</option>)}</select></label><label>고장·보수 부위<input aria-label={`${label} 부위`} disabled={disabled} maxLength={100} value={value.part} placeholder="예: 트로리 와이어" onChange={e=>onChange({...value,part:e.target.value})}/></label><label>사진 설명<textarea aria-label={`${label} 설명`} disabled={disabled} maxLength={500} value={value.caption} placeholder="예: 마모 상태 / 교체 후 상태" onChange={e=>onChange({...value,caption:e.target.value})}/></label></div>;}

export default function RecordPhotos({ photoIds, photoDetails, fileDetails, onPhotoDetailsChange, onFileDetailsChange, files, disabled, onPhotosChange, onFilesChange, onError, onPreparingChange }: Props) {
  const active = useRef(true);
  const preparingLock = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [compressionNote, setCompressionNote] = useState('');
  useEffect(() => { active.current = true; return () => { active.current = false; onPreparingChange(false); }; }, [onPreparingChange]);
  const locked = disabled || preparing;
  const [knownIds, setKnownIds] = useState(() => [...photoIds]);
  useEffect(() => {
    setKnownIds(before => photoIds.some(id => !before.includes(id)) ? Array.from(new Set([...before, ...photoIds])) : before);
  }, [photoIds]);
  const savedIds = Array.from(new Set([...knownIds, ...photoIds]));
  const count = photoIds.length + files.length;
  const removedCount = savedIds.filter(id => !photoIds.includes(id)).length;
  async function selectFiles(selected: File[],stage:PhotoStage) {
    if (!selected.length || preparingLock.current) return;
    preparingLock.current = true;
    setPreparing(true); onPreparingChange(true); onError(''); setCompressionNote('');
    try {
    const prepared: File[] = [];
    const notes: string[] = [];
    for (const original of selected) {
      const photo = await preparePhoto(original);
      if (!active.current) return;
      prepared.push(photo);
      if (photo !== original) notes.push(`${original.name}: ${photoSize(original.size)} → ${photoSize(photo.size)}`);
    }
    const next = [...files];
    for (const file of prepared) {
      if (!next.some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) next.push(file);
    }
    if (photoIds.length + next.length > 5) {
      onError('사진은 기존 사진과 추가할 사진을 합해 총 5장까지 저장할 수 있습니다. 먼저 사진을 삭제해 주세요.');
      return;
    }
    onFilesChange(next);
    onFileDetailsChange({...fileDetails,...Object.fromEntries(prepared.map(file=>[photoFileKey(file),fileDetails[photoFileKey(file)]||emptyPhotoDetail(stage)]))});
    onError('');
    setCompressionNote(notes.length ? `자동 압축 완료 · ${notes.join(' / ')}` : '');
    } catch (failure) {
      if (active.current) onError(`${failure instanceof Error ? failure.message : '사진을 준비하지 못했습니다.'} 기존 선택은 유지됩니다.`);
    } finally {
      preparingLock.current = false;
      if (active.current) { setPreparing(false); onPreparingChange(false); }
    }
  }
  function toggleSaved(id: string) {
    if (photoIds.includes(id)) onPhotosChange(photoIds.filter(value => value !== id));
    else {
      if (count >= 5) { onError('복원하려면 추가할 사진을 취소해 총 5장 이하로 맞춰 주세요.'); return; }
      onPhotosChange(savedIds.filter(value => value === id || photoIds.includes(value)));
    }
    onError('');
  }
  return <section className="record-photos" aria-labelledby="record-photos-title">
    <div className="record-photos-heading"><h3 id="record-photos-title">현장 사진</h3><span role="status">{preparing ? '사진 확인·자동 압축 중…' : `저장할 사진 ${count}/5장${removedCount > 0 ? ` · 삭제 예정 ${removedCount}장` : ''}`}</span></div>
    <p className="record-photos-help">사진 추가·삭제는 ‘서버에 저장’을 눌러야 반영됩니다. 취소하면 기존 사진은 유지됩니다. 다른 기록에 첨부된 사진은 그대로 보존됩니다.</p>
    <p className="record-photos-help">같은 부위를 비슷한 각도로 촬영하면 전·후 비교가 쉽습니다. 기존 사진은 미분류로 표시되며, 사진 구분을 바꿔 이동할 수 있습니다.</p>
    {photoStages.map(stage=><section className={`record-photo-stage photo-stage-${stage}`} key={stage}><h4>{photoStageLabels[stage]} 사진 <span>{photoIds.filter(id=>photoDetail(photoDetails,id).stage===stage).length+files.filter(file=>photoDetail(fileDetails,photoFileKey(file)).stage===stage).length}장</span></h4>
    <div className="record-photos-grid">{savedIds.filter(id=>photoDetail(photoDetails,id).stage===stage).map(id=>{const index=savedIds.indexOf(id),removed=!photoIds.includes(id);return <div key={id} className={`record-photo-card${removed?' is-removed':''}`}><div className="record-photo-image"><Photo id={id} alt={`${photoStageLabels[stage]} 기존 사진 ${index+1}`}/></div><div className="record-photo-caption"><span>{removed?'삭제 예정':`기존 사진 ${index+1}`}</span><button type="button" disabled={locked} onClick={()=>toggleSaved(id)} aria-label={`기존 사진 ${index+1} ${removed?'삭제 취소':'삭제'}`}>{removed?'삭제 취소':'삭제'}</button></div><DetailFields label={`기존 사진 ${index+1}`} value={photoDetail(photoDetails,id)} disabled={locked||removed} onChange={detail=>onPhotoDetailsChange({...photoDetails,[id]:detail})}/></div>;})}
    {files.filter(file=>photoDetail(fileDetails,photoFileKey(file)).stage===stage).map(file=>{const key=photoFileKey(file),index=files.indexOf(file);return <div className="record-photo-card" key={key}><div className="record-photo-image"><SelectedPhoto file={file}/></div><div className="record-photo-caption"><span title={file.name}>추가 예정 · {file.name}<small>{photoSize(file.size)}</small></span><button type="button" disabled={locked} onClick={()=>{onFilesChange(files.filter((_,position)=>position!==index));onError('');}} aria-label={`추가할 사진 ${index+1} 취소`}>추가 취소</button></div><DetailFields label={`추가할 사진 ${index+1}`} value={photoDetail(fileDetails,key)} disabled={locked} onChange={detail=>onFileDetailsChange({...fileDetails,[key]:detail})}/></div>;})}</div>
    {!savedIds.some(id=>photoDetail(photoDetails,id).stage===stage)&&!files.some(file=>photoDetail(fileDetails,photoFileKey(file)).stage===stage)&&<p className="record-photos-empty">등록된 {photoStageLabels[stage]} 사진이 없습니다.</p>}
    <label className="record-photo-picker">{photoStageLabels[stage]} 사진 추가 <small>JPG · PNG · WebP / 5MB 초과 사진 자동 압축 / 전체 합계 5장</small><input aria-label={`${photoStageLabels[stage]} 사진 추가`} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={locked||count>=5} onChange={event=>{void selectFiles(Array.from(event.target.files||[]),stage);event.target.value='';}}/></label>
    </section>)}
    {compressionNote&&<p className="record-photos-help" role="status">{compressionNote}</p>}
  </section>;
}
